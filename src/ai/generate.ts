import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { aiModels, aiProviders } from '../db/schema';
import { AppError } from '../domain/errors';
import {
  type LessonOutput,
  lessonOutputSchema,
  type QuizOutput,
  quizOutputSchema,
  type RoadmapOutput,
  roadmapOutputSchema,
  type TaskName,
} from '../domain/schemas';
import { logEvent } from '../server/log';

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

export async function completeJson(
  env: Env,
  model: ModelRow,
  input: unknown,
  task: TaskName,
): Promise<unknown> {
  if (model.authKind === 'workers_ai_binding')
    throw new ModelError('provider_timeout');
  const secretName = model.secretName;
  const apiKey = secretName ? readProviderSecret(env, secretName) : null;
  if (!apiKey) throw new ModelError('provider_timeout');
  if (apiKey === 'mock' || apiKey === 'fail')
    return mockCompletion(env, task, input, apiKey);
  const base = model.baseUrl.replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model.modelName,
        messages: [
          { role: 'system', content: model.prompt },
          { role: 'user', content: JSON.stringify(input) },
        ],
        max_tokens: model.maxOutputTokens,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
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
    logEvent({
      message: 'model_status',
      errorCode: 'provider_timeout',
      status: String(response.status),
    });
    throw new ModelError('provider_timeout');
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new ModelError('invalid_output');
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ModelError('invalid_output');
  }
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
    case 'BRAVE_SEARCH_API_KEY':
      return env.BRAVE_SEARCH_API_KEY || null;
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
  if (task === 'lesson') return mockLesson(input);
  return mockQuiz();
}

function mockRoadmap(input: unknown): RoadmapOutput {
  const record =
    typeof input === 'object' && input !== null
      ? (input as { topic?: string; maxChapters?: number; maxLessons?: number })
      : {};
  const topic = record.topic || 'Topik';
  const chapters = Math.min(record.maxChapters ?? 2, 2);
  const lessons = Math.min(record.maxLessons ?? 2, 2);
  return {
    title: `Belajar ${topic}`,
    chapters: Array.from({ length: chapters }, (_, chapterIndex) => ({
      title: `Bab ${chapterIndex + 1}`,
      summary: `Ringkasan bab ${chapterIndex + 1} untuk ${topic}.`,
      lessons: Array.from({ length: lessons }, (_, lessonIndex) => ({
        title: `Pelajaran ${chapterIndex + 1}.${lessonIndex + 1}`,
        objective: `Memahami bagian ${lessonIndex + 1} dari bab ini.`,
      })),
    })),
  };
}

function mockLesson(input: unknown): LessonOutput {
  const record =
    typeof input === 'object' && input !== null
      ? (input as { title?: string; objective?: string })
      : {};
  const title = record.title || 'Pelajaran';
  const objective = record.objective || 'Memahami pokok bahasan.';
  const sourced = `${title} punya langkah yang bisa dicek.`;
  const unsourced = 'Angka contoh ini tidak punya tautan.';
  return {
    markdown: `## ${title}\n\n${objective}\n\n${sourced}\n\n${unsourced}`,
    claims: [
      { quote: sourced, search_query: title },
      { quote: unsourced, search_query: 'tanpa-hasil' },
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
