import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { aiModels, aiProviders } from '../db/schema';
import { AppError } from '../domain/errors';
import { requireAllowedLlmBaseUrl } from '../domain/provider-url';
import {
  type LessonOutput,
  lessonOutputSchema,
  type OutlineLessonOutput,
  outlineLessonOutputSchema,
  type QuizOutput,
  quizOutputSchema,
  type RoadmapOutput,
  roadmapOutputSchema,
  type TaskName,
} from '../domain/schemas';
import { logEvent } from '../server/log';
import type { ToolDefinition } from './tools';

export class ModelError extends Error {
  readonly errorCode: 'provider_timeout' | 'invalid_output';

  constructor(errorCode: 'provider_timeout' | 'invalid_output') {
    super(errorCode);
    this.name = 'ModelError';
    this.errorCode = errorCode;
  }
}

type ModelRow = {
  modelName: string;
  maxOutputTokens: number;
  timeoutMs: number;
  baseUrl: string;
  authKind: 'bearer' | 'workers_ai_binding';
  secretName: string | null;
  prompt: string;
};

export async function loadModel(
  db: Database,
  task: TaskName,
  prompt: string,
): Promise<ModelRow> {
  const rows = await db
    .select({
      modelName: aiModels.modelName,
      maxOutputTokens: aiModels.maxOutputTokens,
      timeoutMs: aiModels.timeoutMs,
      baseUrl: aiProviders.baseUrl,
      authKind: aiProviders.authKind,
      secretName: aiProviders.secretName,
    })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
    .where(and(eq(aiModels.task, task), eq(aiModels.active, 1)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ModelError('invalid_output');
  return { ...row, prompt };
}

const TASK_TEMPERATURE: Record<TaskName, number> = {
  roadmap: 0.3,
  lesson: 0.7,
  quiz: 0.2,
};

export async function completeJson(
  env: Env,
  model: ModelRow,
  input: unknown,
  task: TaskName,
  options?: { temperature?: number; tool?: ToolDefinition },
): Promise<unknown> {
  if (model.authKind === 'workers_ai_binding')
    throw new ModelError('provider_timeout');
  const secretName = model.secretName;
  const apiKey = secretName ? readProviderSecret(env, secretName) : null;
  if (!apiKey) throw new ModelError('provider_timeout');
  if (apiKey === 'mock' || apiKey === 'fail')
    return mockCompletion(env, task, input, apiKey);
  requireAllowedLlmBaseUrl(model.baseUrl);
  const startedAt = Date.now();
  const payload = await requestCompletion(
    model,
    apiKey,
    input,
    task,
    options,
    Boolean(options?.tool),
  );
  logEvent({
    message: 'model_usage',
    status: task,
    model: model.modelName,
    ms: Date.now() - startedAt,
    usage: {
      prompt: payload.usage?.prompt_tokens,
      completion: payload.usage?.completion_tokens,
      total: payload.usage?.total_tokens,
    },
  });
  const message = payload.choices?.[0]?.message;
  const toolArguments = message?.tool_calls?.[0]?.function?.arguments;
  if (typeof toolArguments === 'string' && toolArguments.trim()) {
    try {
      return JSON.parse(toolArguments) as unknown;
    } catch {
      throw new ModelError('invalid_output');
    }
  }
  const content = message?.content;
  if (!content) throw new ModelError('invalid_output');
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ModelError('invalid_output');
  }
}

type CompletionPayload = {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: { function?: { arguments?: string } }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

const TOOLS_FALLBACK_STATUSES = new Set([400, 404, 422]);

async function requestCompletion(
  model: ModelRow,
  apiKey: string,
  input: unknown,
  task: TaskName,
  options: { temperature?: number; tool?: ToolDefinition } | undefined,
  useTools: boolean,
): Promise<CompletionPayload> {
  const base = model.baseUrl.replace(/\/$/, '');
  const body: Record<string, unknown> = {
    model: model.modelName,
    messages: [
      { role: 'system', content: model.prompt },
      { role: 'user', content: JSON.stringify(input) },
    ],
    max_tokens: model.maxOutputTokens,
    temperature: options?.temperature ?? TASK_TEMPERATURE[task] ?? 0.4,
  };
  if (useTools && options?.tool) {
    body.tools = [{ type: 'function', function: options.tool }];
    body.tool_choice = {
      type: 'function',
      function: { name: options.tool.name },
    };
  } else {
    body.response_format = { type: 'json_object' };
  }
  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(model.timeoutMs),
    });
  } catch (error) {
    logEvent({
      message: 'model_request_failed',
      errorCode: 'provider_timeout',
      status: error instanceof Error ? error.name : 'error',
    });
    throw new ModelError('provider_timeout');
  }
  if (!response.ok) {
    if (useTools && TOOLS_FALLBACK_STATUSES.has(response.status)) {
      logEvent({
        message: 'model_tools_fallback',
        status: `${task}:${response.status}`,
        model: model.modelName,
      });
      return requestCompletion(model, apiKey, input, task, options, false);
    }
    logEvent({
      message: 'model_status',
      errorCode: 'provider_timeout',
      status: String(response.status),
    });
    throw new ModelError('provider_timeout');
  }
  return (await response.json()) as CompletionPayload;
}

export function parseOutlineLessonOutput(value: unknown): OutlineLessonOutput {
  const parsed = outlineLessonOutputSchema.safeParse(value);
  if (!parsed.success) throw new ModelError('invalid_output');
  return parsed.data;
}

export function parseModelOutput(
  task: TaskName,
  value: unknown,
): RoadmapOutput | LessonOutput | QuizOutput {
  const parsed =
    task === 'roadmap'
      ? roadmapOutputSchema.safeParse(value)
      : task === 'lesson'
        ? lessonOutputSchema.safeParse(value)
        : task === 'quiz'
          ? quizOutputSchema.safeParse(value)
          : null;
  if (!parsed?.success) throw new ModelError('invalid_output');
  return parsed.data;
}

function readProviderSecret(env: Env, name: string): string | null {
  switch (name) {
    case 'OPENAI_API_KEY':
      return env.OPENAI_API_KEY || null;
    case 'YOUTUBE_API_KEY':
      return env.YOUTUBE_API_KEY || null;
    default:
      return null;
  }
}

async function mockCompletion(
  env: Env,
  task: TaskName,
  input: unknown,
  apiKey: string,
): Promise<unknown> {
  const mode = apiKey === 'fail' ? 'fail' : await env.APP_KV.get('dev:ai-mode');
  if (mode === 'fail') throw new ModelError('provider_timeout');
  if (task === 'roadmap') return mockRoadmap(input);
  if (task === 'lesson') {
    const mode =
      typeof input === 'object' && input !== null
        ? (input as { mode?: string }).mode
        : undefined;
    if (mode === 'outline') return mockOutlineLesson(input);
    return mockLesson(input);
  }
  return mockQuiz();
}

function mockOutlineLesson(input: unknown): OutlineLessonOutput {
  const record =
    typeof input === 'object' && input !== null
      ? (input as {
          chapterTitle?: string;
          existingLessons?: { title: string }[];
        })
      : {};
  const chapter = record.chapterTitle ?? 'Bab';
  const count = (record.existingLessons?.length ?? 0) + 1;
  return {
    title: `Contoh penerapan: sudut yang belum dibahas (${count})`,
    objective: `Menerapkan konsep ${chapter} pada contoh singkat yang konsisten dengan jalur.`,
  };
}

function mockRoadmap(input: unknown): RoadmapOutput {
  const record =
    typeof input === 'object' && input !== null
      ? (input as { topic?: string; maxChapters?: number; maxLessons?: number })
      : {};
  const topic = record.topic || 'Topik';
  const chapterCount = Math.min(record.maxChapters ?? 4, 4);
  const lessonCap = record.maxLessons ?? 4;
  const lessonCount = Math.min(Math.max(1, lessonCap - 1), 4);
  const arc = [
    'Fondasi konsep',
    'Teknik inti',
    'Penerapan praktis',
    'Perangkap dan sintesis',
  ];
  return {
    title: topic.length > 48 ? `${topic.slice(0, 45)}…` : topic,
    chapters: Array.from({ length: chapterCount }, (_, chapterIndex) => {
      const chapterTitle = arc[chapterIndex] ?? `Bab ${chapterIndex + 1}`;
      return {
        title: chapterTitle,
        summary: `Bab ini membangun ${chapterTitle.toLowerCase()} untuk ${topic}, lalu menyiapkan bab berikutnya.`,
        lessons: Array.from({ length: lessonCount }, (_, lessonIndex) => ({
          title: `Gagasan kunci ${chapterIndex + 1}.${lessonIndex + 1} tentang ${topic}`,
          objective: `Menjelaskan satu aspek ${chapterTitle.toLowerCase()} yang relevan dengan ${topic}.`,
        })),
      };
    }),
  };
}

function mockLesson(input: unknown): LessonOutput {
  const record =
    typeof input === 'object' && input !== null
      ? (input as { title?: string; objective?: string })
      : {};
  const title = record.title || 'Pelajaran';
  const objective = record.objective || 'Memahami pokok bahasan.';
  return {
    markdown: `## Inti jawaban

${objective}

## Konsep inti

${title} membahas satu gagasan yang bisa dipakai langsung. [[s1]]

## Cara menerapkan

1. Tulis masalahnya dalam satu kalimat.
2. Pilih satu langkah kecil yang bisa dicek.

## Kesalahan umum

- Mulai dari alat sebelum masalahnya jelas.

## **Inti pelajaran:**

${objective}`,
    sources: [
      {
        id: 's1',
        url: 'https://example.com/rujukan',
        title: 'Contoh rujukan',
        publisher: 'example.com',
        kind: 'article',
      },
    ],
  };
}

function mockQuiz(): QuizOutput {
  return {
    questions: [0, 1, 2].map((index) => ({
      stem: `Soal ${index + 1}: mana pernyataan yang sesuai bahan?`,
      choices: [
        'Sesuai bahan',
        'Tidak disebut',
        'Bertentangan',
        'Di luar bahan',
      ] as [string, string, string, string],
      correct_index: 0,
      explanation: 'Pilihan lain tidak ada pada bahan bab ini.',
    })),
  };
}

export function assertConfiguredSecret(name: string | null | undefined): void {
  if (name && !/^[A-Z0-9_]+$/.test(name))
    throw new AppError('validation', 'Nama secret tidak valid.');
}
