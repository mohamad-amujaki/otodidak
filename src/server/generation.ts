import { and, asc, eq } from 'drizzle-orm';
import {
  completeJson,
  loadModel,
  ModelError,
  parseModelOutput,
  parseOutlineLessonOutput,
} from '../ai/generate';
import { generatorTools } from '../ai/tools';
import {
  debitIfEnough,
  findLedgerByKey,
  insertLedger,
} from '../billing/ledger';
import type { Database } from '../db/client';
import {
  chapters,
  creditLedger,
  type GenerationKind,
  generationJobs,
  lessonClaims,
  lessonSources,
  lessons,
  paths,
  promptTemplates,
  quizAttempts,
  quizQuestions,
  quizzes,
  type UserRow,
} from '../db/schema';
import {
  JOB_LOCK_TTL_SECONDS,
  MAX_LESSON_SOURCES,
  QUEUE_MAX_ATTEMPTS,
  QUIZ_SNIPPET_CHARS,
} from '../domain/defaults';
import { AppError } from '../domain/errors';
import { auditLessonQuality } from '../domain/lesson-quality';
import { SEED_PROMPTS } from '../domain/prompts';
import type {
  LessonOutput,
  QuizOutput,
  RoadmapOutput,
} from '../domain/schemas';
import { nowIso } from '../domain/time';
import { searchYouTube } from '../sources/search';
import { database, loadConfig, requireActiveJobClear } from './account';
import { logEvent } from './log';
import { allowGenerateIp, assertUserGenerationRate } from './rate';

export type GenerationMessage = { jobId: string };

export async function handleQueue(
  batch: MessageBatch<GenerationMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const jobId = message.body?.jobId;
    if (!jobId) {
      message.ack();
      continue;
    }
    try {
      if (batch.queue.endsWith('dlq')) {
        await refundById(env, jobId);
        message.ack();
        continue;
      }
      const result = await processGeneration(env, jobId, message.attempts);
      if (result === 'retry') message.retry();
      else message.ack();
    } catch {
      if (message.attempts >= QUEUE_MAX_ATTEMPTS) {
        await refundById(env, jobId);
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}

export async function processGeneration(
  env: Env,
  jobId: string,
  attempt: number,
): Promise<'ack' | 'retry'> {
  const db = await database(env);
  const rows = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  const job = rows[0];
  if (!job || job.status === 'succeeded' || job.status === 'failed')
    return 'ack';
  const now = nowIso();
  await db
    .update(generationJobs)
    .set({
      status: 'running',
      attempts: attempt,
      startedAt: job.startedAt ?? now,
    })
    .where(eq(generationJobs.id, job.id));
  try {
    const config = await loadConfig(db);
    if (job.kind === 'roadmap')
      await writeRoadmap(
        env,
        db,
        job.userId,
        job.refId,
        config.maxChapters,
        config.maxLessonsPerChapter,
      );
    else if (job.kind === 'lesson') await writeLesson(env, db, job.refId);
    else await writeQuiz(env, db, job.refId, config.quizQuestionCount);
    const promptRow = await db
      .select({ version: promptTemplates.version })
      .from(promptTemplates)
      .where(eq(promptTemplates.task, job.kind))
      .limit(1);
    await db
      .update(generationJobs)
      .set({
        status: 'succeeded',
        errorCode: null,
        finishedAt: nowIso(),
        promptVersion: promptRow[0]?.version ?? null,
      })
      .where(eq(generationJobs.id, job.id));
    await env.APP_KV.delete(lockKey(job.userId));
    logEvent({
      message: 'generation_succeeded',
      jobId: job.id,
      userId: job.userId,
      status: 'succeeded',
    });
    return 'ack';
  } catch (error) {
    const errorCode =
      error instanceof ModelError ? error.errorCode : 'provider_timeout';
    const invalidOutput =
      error instanceof ModelError && error.errorCode === 'invalid_output';
    logEvent({
      message: 'generation_failed',
      jobId: job.id,
      userId: job.userId,
      errorCode,
      status: String(attempt),
    });
    // Output invalid tidak akan membaik dengan input yang sama: gagal cepat.
    if (invalidOutput || attempt >= QUEUE_MAX_ATTEMPTS) {
      await refundJob(env, db, job);
      return 'ack';
    }
    return 'retry';
  }
}

export async function startRoadmap(
  env: Env,
  request: Request,
  user: UserRow,
  topic: string,
): Promise<{ pathId: string; jobId: string }> {
  const db = await database(env);
  const config = await loadConfig(db);
  const pathId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    userId: user.id,
    kind: 'roadmap' as const,
    refId: pathId,
  };
  await beginJob(env, request, db, user, {
    jobId,
    kind: 'roadmap',
    refId: pathId,
    cost: config.costRoadmap,
    reason: 'roadmap',
    idempotencyKey: `roadmap:${jobId}`,
  });
  const now = nowIso();
  try {
    await db.insert(paths).values({
      id: pathId,
      userId: user.id,
      title: 'Menyusun jalur',
      topic,
      status: 'draft',
      isActive: 0,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    await refundJob(env, db, job);
    throw new AppError('generation_failed');
  }
  await enqueue(env, db, job);
  return { pathId, jobId };
}

export async function openLesson(
  env: Env,
  request: Request,
  user: UserRow,
  lessonId: string,
) {
  const db = await database(env);
  const lesson = await ownedLesson(db, user.id, lessonId);
  if (!lesson) throw new AppError('not_found');
  if (lesson.body && lesson.status === 'ready')
    return { ready: true as const, lessonId };
  if (lesson.status === 'queued') throw new AppError('generation_in_progress');
  const config = await loadConfig(db);
  const jobId = crypto.randomUUID();
  const baseKey = `lesson:${lessonId}`;
  const existing = await findLedgerByKey(db, baseKey);
  let idempotencyKey = baseKey;
  if (existing) {
    const refunded = await hasRefund(db, lessonId);
    if (lesson.body == null && lesson.status === 'outline' && refunded)
      idempotencyKey = `lesson:${lessonId}:retry:${jobId}`;
    else throw new AppError('generation_in_progress');
  }
  const job = {
    id: jobId,
    userId: user.id,
    kind: 'lesson' as const,
    refId: lessonId,
  };
  await beginJob(env, request, db, user, {
    jobId,
    kind: 'lesson',
    refId: lessonId,
    cost: config.costLesson,
    reason: 'lesson',
    idempotencyKey,
  });
  await db
    .update(lessons)
    .set({ status: 'queued' })
    .where(eq(lessons.id, lessonId));
  await enqueue(env, db, job);
  return { ready: false as const, jobId, lessonId };
}

export async function suggestChapterLesson(
  env: Env,
  request: Request,
  user: UserRow,
  chapterId: string,
): Promise<{ lessonId: string; title: string; objective: string }> {
  const db = await database(env);
  const chapter = await ownedChapter(db, user.id, chapterId);
  if (!chapter) throw new AppError('not_found');
  const pathRows = await db
    .select()
    .from(paths)
    .where(eq(paths.id, chapter.pathId))
    .limit(1);
  const path = pathRows[0];
  if (path?.status !== 'ready') {
    throw new AppError('validation', 'Jalur belum siap untuk disunting.');
  }
  const config = await loadConfig(db);
  const existing = await db
    .select({
      title: lessons.title,
      objective: lessons.objective,
      position: lessons.position,
    })
    .from(lessons)
    .where(eq(lessons.chapterId, chapterId))
    .orderBy(asc(lessons.position));
  if (existing.length >= config.maxLessonsPerChapter) {
    throw new AppError(
      'validation',
      'Batas pelajaran pada bab ini sudah tercapai.',
    );
  }
  if (user.status === 'suspended') throw new AppError('account_suspended');
  if (!(await allowGenerateIp(env.APP_KV, request)))
    throw new AppError('rate_limited');
  await assertUserGenerationRate(db, user.id);
  await requireActiveJobClear(db, user.id);

  const attemptId = crypto.randomUUID();
  const cost = config.costQuiz;
  const debited = await debitIfEnough(db, {
    userId: user.id,
    amount: -cost,
    reason: 'outline',
    refType: 'outline-lesson',
    refId: attemptId,
    idempotencyKey: `outline-lesson:${attemptId}`,
    note: chapter.title,
  });
  if (debited === 'insufficient') throw new AppError('insufficient_credits');
  if (debited === 'duplicate') throw new AppError('generation_in_progress');

  const modelInput = {
    mode: 'outline' as const,
    pathTitle: path.title,
    topic: path.topic,
    chapterTitle: chapter.title,
    chapterSummary: chapter.summary,
    existingLessons: existing.map((lesson) => ({
      title: lesson.title,
      objective: lesson.objective,
    })),
  };

  let outline: { title: string; objective: string };
  try {
    const model = await loadModel(db, 'lesson', SEED_PROMPTS.outlineLesson);
    const raw = await completeJson(env, model, modelInput, 'lesson', {
      temperature: 0.2,
      tool: generatorTools.outlineLesson,
    });
    outline = parseOutlineLessonOutput(raw);
  } catch (error) {
    await insertLedger(db, {
      userId: user.id,
      amount: cost,
      reason: 'refund',
      refType: 'outline-lesson',
      refId: attemptId,
      idempotencyKey: `refund:outline-lesson:${attemptId}`,
    });
    logEvent({
      message: 'outline_lesson_failed',
      userId: user.id,
      errorCode:
        error instanceof ModelError ? error.errorCode : 'generation_failed',
    });
    throw new AppError('generation_failed');
  }

  const lessonId = crypto.randomUUID();
  const now = nowIso();
  try {
    await db.insert(lessons).values({
      id: lessonId,
      chapterId,
      position: existing.length,
      title: outline.title.trim(),
      objective: outline.objective.trim(),
      body: null,
      status: 'outline',
      completedAt: null,
      createdAt: now,
    });
    await db.update(paths).set({ updatedAt: now }).where(eq(paths.id, path.id));
  } catch {
    await insertLedger(db, {
      userId: user.id,
      amount: cost,
      reason: 'refund',
      refType: 'outline-lesson',
      refId: attemptId,
      idempotencyKey: `refund:outline-lesson:${attemptId}`,
    });
    throw new AppError('generation_failed');
  }
  return { lessonId, title: outline.title, objective: outline.objective };
}

export async function startQuiz(
  env: Env,
  request: Request,
  user: UserRow,
  chapterId: string,
): Promise<{ quizId: string; jobId: string }> {
  const db = await database(env);
  const chapter = await ownedChapter(db, user.id, chapterId);
  if (!chapter) throw new AppError('not_found');
  const config = await loadConfig(db);
  const quizId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    userId: user.id,
    kind: 'quiz' as const,
    refId: quizId,
  };
  await beginJob(env, request, db, user, {
    jobId,
    kind: 'quiz',
    refId: quizId,
    cost: config.costQuiz,
    reason: 'quiz',
    idempotencyKey: `quiz:${quizId}`,
  });
  try {
    await db
      .insert(quizzes)
      .values({ id: quizId, chapterId, createdAt: nowIso() });
  } catch {
    await refundJob(env, db, job);
    throw new AppError('generation_failed');
  }
  await enqueue(env, db, job);
  return { quizId, jobId };
}

async function beginJob(
  env: Env,
  request: Request,
  db: Database,
  user: UserRow,
  input: {
    jobId: string;
    kind: GenerationKind;
    refId: string;
    cost: number;
    reason: 'roadmap' | 'lesson' | 'quiz';
    idempotencyKey: string;
  },
): Promise<void> {
  if (user.status === 'suspended') throw new AppError('account_suspended');
  if (!(await allowGenerateIp(env.APP_KV, request)))
    throw new AppError('rate_limited');
  await assertUserGenerationRate(db, user.id);
  await clearStaleLock(env, db, user.id);
  await requireActiveJobClear(db, user.id);
  const debited = await debitIfEnough(db, {
    userId: user.id,
    amount: -input.cost,
    reason: input.reason,
    refType: 'job',
    refId: input.jobId,
    idempotencyKey: input.idempotencyKey,
  });
  if (debited === 'insufficient') throw new AppError('insufficient_credits');
  if (debited === 'duplicate') throw new AppError('generation_in_progress');
  try {
    await db.insert(generationJobs).values({
      id: input.jobId,
      userId: user.id,
      kind: input.kind,
      refId: input.refId,
      status: 'queued',
      errorCode: null,
      attempts: 0,
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
    });
  } catch {
    await refundJob(env, db, {
      id: input.jobId,
      userId: user.id,
      kind: input.kind,
      refId: input.refId,
    });
    throw new AppError('generation_in_progress');
  }
  await env.APP_KV.put(lockKey(user.id), input.jobId, {
    expirationTtl: JOB_LOCK_TTL_SECONDS,
  });
}

async function enqueue(
  env: Env,
  db: Database,
  job: { id: string; userId: string; kind: GenerationKind; refId: string },
): Promise<void> {
  try {
    await env.GENERATION_QUEUE.send({ jobId: job.id });
  } catch {
    await refundJob(env, db, job);
    logEvent({
      message: 'queue_send_failed',
      jobId: job.id,
      userId: job.userId,
      errorCode: 'refunded',
    });
    throw new AppError('generation_failed');
  }
}

async function writeRoadmap(
  env: Env,
  db: Database,
  userId: string,
  pathId: string,
  maxChapters: number,
  maxLessons: number,
): Promise<void> {
  const pathRows = await db
    .select()
    .from(paths)
    .where(and(eq(paths.id, pathId), eq(paths.userId, userId)))
    .limit(1);
  const path = pathRows[0];
  if (!path) throw new ModelError('invalid_output');
  const output = await runModel(env, db, 'roadmap', {
    topic: path.topic,
    maxChapters,
    maxLessons,
  });
  if (!isRoadmap(output)) throw new ModelError('invalid_output');
  const trimmed = output.chapters
    .slice(0, maxChapters)
    .map((chapter) => ({
      ...chapter,
      lessons: chapter.lessons.slice(0, maxLessons),
    }))
    .filter((chapter) => chapter.lessons.length > 0);
  if (trimmed.length === 0) throw new ModelError('invalid_output');
  const now = nowIso();
  await db
    .update(paths)
    .set({
      title: output.title,
      status: 'ready',
      isActive: 0,
      updatedAt: now,
    })
    .where(eq(paths.id, pathId));
  for (const [chapterIndex, chapter] of trimmed.entries()) {
    const chapterId = crypto.randomUUID();
    await db.insert(chapters).values({
      id: chapterId,
      pathId,
      position: chapterIndex,
      title: chapter.title,
      summary: chapter.summary,
      quizStatus: 'unchecked',
    });
    for (const [lessonIndex, lesson] of chapter.lessons.entries()) {
      await db.insert(lessons).values({
        id: crypto.randomUUID(),
        chapterId,
        position: lessonIndex,
        title: lesson.title,
        objective: lesson.objective,
        body: null,
        status: 'outline',
        completedAt: null,
        createdAt: now,
      });
    }
  }
}

async function writeLesson(
  env: Env,
  db: Database,
  lessonId: string,
): Promise<void> {
  const context = await lessonContext(db, lessonId);
  if (!context) throw new ModelError('invalid_output');
  const output = await runModel(env, db, 'lesson', {
    pathTitle: context.pathTitle,
    topic: context.topic,
    chapterTitle: context.chapterTitle,
    chapterSummary: context.chapterSummary,
    title: context.title,
    objective: context.objective,
    previousLessons: context.previousLessons,
    recentTakeaways: context.recentTakeaways,
    neighbors: context.neighbors,
  });
  if (!isLesson(output)) throw new ModelError('invalid_output');
  if (output.markdown.length > 100_000) throw new ModelError('invalid_output');
  const sources: {
    id: string;
    kind: 'web' | 'youtube';
    url: string;
    title: string;
  }[] = [];
  const idMap = new Map<string, string>();
  for (const source of output.sources) {
    if (sources.length >= MAX_LESSON_SOURCES) break;
    const existing = sources.find((item) => item.url === source.url);
    if (existing) {
      idMap.set(source.id, existing.id);
      continue;
    }
    const sourceId = crypto.randomUUID();
    idMap.set(source.id, sourceId);
    sources.push({
      id: sourceId,
      kind: source.kind === 'video' ? 'youtube' : 'web',
      url: source.url,
      title: source.title,
    });
  }
  let markdown = output.markdown.replace(
    /\[\[([A-Za-z0-9_-]{1,64})\]\]/g,
    (_whole, modelId: string) => {
      const mapped = idMap.get(modelId);
      return mapped ? `[[${mapped}]]` : '';
    },
  );
  const uncited = sources.filter(
    (source) => !markdown.includes(`[[${source.id}]]`),
  );
  if (uncited.length > 0)
    markdown = `${markdown.trimEnd()} ${uncited
      .map((source) => `[[${source.id}]]`)
      .join(' ')}`;
  try {
    const video = await searchYouTube(
      env,
      db,
      `${context.title} ${context.topic}`,
    );
    if (
      video?.url.startsWith('https://') &&
      sources.length < MAX_LESSON_SOURCES &&
      !sources.some((item) => item.url === video.url)
    )
      sources.push({
        id: crypto.randomUUID(),
        kind: 'youtube',
        url: video.url,
        title: video.title,
      });
  } catch {
    logEvent({ message: 'youtube_skipped', errorCode: 'source_failed' });
  }
  await db.delete(lessonClaims).where(eq(lessonClaims.lessonId, lessonId));
  await db.delete(lessonSources).where(eq(lessonSources.lessonId, lessonId));
  for (const [position, source] of sources.entries()) {
    await db.insert(lessonSources).values({ ...source, lessonId, position });
  }
  const quality = auditLessonQuality(markdown);
  if (quality.issues.length > 0)
    logEvent({
      message: 'lesson_quality',
      status: 'warn',
      errorCode: quality.issues.join(' | ').slice(0, 180),
    });
  await db
    .update(lessons)
    .set({ body: markdown, status: 'ready' })
    .where(eq(lessons.id, lessonId));
}

async function writeQuiz(
  env: Env,
  db: Database,
  quizId: string,
  questionCount: number,
): Promise<void> {
  const quizRows = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1);
  const quiz = quizRows[0];
  if (!quiz) throw new ModelError('invalid_output');
  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, quiz.chapterId))
    .limit(1);
  const chapter = chapterRows[0];
  if (!chapter) throw new ModelError('invalid_output');
  const lessonRows = await db
    .select()
    .from(lessons)
    .where(eq(lessons.chapterId, chapter.id));
  const claimTexts: string[] = [];
  for (const lesson of lessonRows) {
    const claims = await db
      .select({ quote: lessonClaims.quote })
      .from(lessonClaims)
      .where(eq(lessonClaims.lessonId, lesson.id));
    for (const claim of claims) claimTexts.push(claim.quote);
  }
  let snippet = '';
  if (claimTexts.length === 0) {
    snippet = lessonRows
      .map((lesson) => lesson.body ?? '')
      .join('\n')
      .slice(0, QUIZ_SNIPPET_CHARS);
  }
  const output = await runModel(env, db, 'quiz', {
    chapterTitle: chapter.title,
    lessonTitles: lessonRows.map((lesson) => lesson.title),
    claims: claimTexts,
    snippet,
    questionCount,
  });
  if (!isQuiz(output)) throw new ModelError('invalid_output');
  const questions = output.questions.slice(0, questionCount);
  if (questions.length === 0) throw new ModelError('invalid_output');
  for (const [position, question] of questions.entries()) {
    await db.insert(quizQuestions).values({
      id: crypto.randomUUID(),
      quizId,
      position,
      stem: question.stem,
      choicesJson: JSON.stringify(question.choices),
      correctIndex: question.correct_index,
      explanation: question.explanation,
    });
  }
  const others = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.chapterId, chapter.id));
  for (const other of others) {
    if (other.id === quizId) continue;
    await db.delete(quizAttempts).where(eq(quizAttempts.quizId, other.id));
    await db.delete(quizQuestions).where(eq(quizQuestions.quizId, other.id));
    await db.delete(quizzes).where(eq(quizzes.id, other.id));
  }
  await db
    .update(chapters)
    .set({ quizStatus: 'unchecked' })
    .where(eq(chapters.id, chapter.id));
}

async function runModel(
  env: Env,
  db: Database,
  task: GenerationKind,
  input: unknown,
) {
  const prompts = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.task, task))
    .limit(1);
  const prompt = prompts[0]?.body;
  if (!prompt) throw new ModelError('invalid_output');
  const model = await loadModel(db, task, prompt);
  const raw = await completeJson(env, model, input, task, {
    tool: generatorTools[task],
  });
  return parseModelOutput(task, raw);
}

function isRoadmap(
  value: RoadmapOutput | LessonOutput | QuizOutput,
): value is RoadmapOutput {
  return 'chapters' in value;
}

function isLesson(
  value: RoadmapOutput | LessonOutput | QuizOutput,
): value is LessonOutput {
  return 'markdown' in value;
}

function isQuiz(
  value: RoadmapOutput | LessonOutput | QuizOutput,
): value is QuizOutput {
  return 'questions' in value;
}

async function lessonContext(db: Database, lessonId: string) {
  const lessonRows = await db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  const lesson = lessonRows[0];
  if (!lesson) return null;
  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, lesson.chapterId))
    .limit(1);
  const chapter = chapterRows[0];
  if (!chapter) return null;
  const pathRows = await db
    .select()
    .from(paths)
    .where(eq(paths.id, chapter.pathId))
    .limit(1);
  const path = pathRows[0];
  if (!path) return null;
  const chapterRowsAll = await db
    .select()
    .from(chapters)
    .where(eq(chapters.pathId, path.id));
  const ordered: { title: string; body: string | null }[] = [];
  const sortedChapters = [...chapterRowsAll].sort(
    (left, right) => left.position - right.position,
  );
  for (const item of sortedChapters) {
    const chapterLessons = await db
      .select()
      .from(lessons)
      .where(eq(lessons.chapterId, item.id));
    for (const entry of [...chapterLessons].sort(
      (left, right) => left.position - right.position,
    ))
      ordered.push({ title: entry.title, body: entry.body ?? null });
  }
  const index = ordered.findIndex((item) => item.title === lesson.title);
  const earlier = index > 0 ? ordered.slice(0, index) : [];
  const neighbors = [
    ordered[index - 1]?.title,
    ordered[index + 1]?.title,
  ].filter((item): item is string => Boolean(item));
  return {
    pathTitle: path.title,
    topic: path.topic,
    chapterTitle: chapter.title,
    chapterSummary: chapter.summary,
    title: lesson.title,
    objective: lesson.objective,
    previousLessons: earlier.slice(-6).map((item) => item.title),
    recentTakeaways: earlier
      .slice(-3)
      .map((item) => takeawayOf(item.body))
      .filter((item): item is string => Boolean(item)),
    neighbors,
  };
}

function takeawayOf(body: string | null): string | null {
  if (!body) return null;
  const marked = body.match(/\*\*Inti pelajaran:\*\*\s*([\s\S]+)/i);
  const source = (marked?.[1] ?? body).trim();
  const paragraph =
    source
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean)
      .pop() ?? '';
  const clean = paragraph.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 240) : null;
}

async function ownedLesson(db: Database, userId: string, lessonId: string) {
  const lessonRows = await db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  const lesson = lessonRows[0];
  if (!lesson) return null;
  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, lesson.chapterId))
    .limit(1);
  const chapter = chapterRows[0];
  if (!chapter) return null;
  const pathRows = await db
    .select()
    .from(paths)
    .where(and(eq(paths.id, chapter.pathId), eq(paths.userId, userId)))
    .limit(1);
  if (!pathRows[0]) return null;
  return lesson;
}

async function ownedChapter(db: Database, userId: string, chapterId: string) {
  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1);
  const chapter = chapterRows[0];
  if (!chapter) return null;
  const pathRows = await db
    .select()
    .from(paths)
    .where(and(eq(paths.id, chapter.pathId), eq(paths.userId, userId)))
    .limit(1);
  if (!pathRows[0]) return null;
  return chapter;
}

async function hasRefund(db: Database, lessonId: string): Promise<boolean> {
  const jobs = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.refId, lessonId),
        eq(generationJobs.kind, 'lesson'),
        eq(generationJobs.status, 'failed'),
      ),
    );
  for (const job of jobs) {
    const refund = await findLedgerByKey(db, `refund:${job.id}`);
    if (refund) return true;
  }
  return false;
}

async function refundById(env: Env, jobId: string): Promise<void> {
  const db = await database(env);
  const rows = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  const job = rows[0];
  if (!job || job.status === 'succeeded') return;
  await refundJob(env, db, job);
}

export async function refundJob(
  env: Env,
  db: Database,
  job: { id: string; userId: string; kind: GenerationKind; refId: string },
): Promise<void> {
  const debits = await db
    .select()
    .from(creditLedger)
    .where(
      and(eq(creditLedger.refId, job.id), eq(creditLedger.reason, job.kind)),
    );
  const debit = debits.find((row) => row.amount < 0);
  if (debit) {
    await insertLedger(db, {
      userId: job.userId,
      amount: Math.abs(debit.amount),
      reason: 'refund',
      refType: 'job',
      refId: job.id,
      idempotencyKey: `refund:${job.id}`,
    });
  }
  await db
    .update(generationJobs)
    .set({ status: 'failed', errorCode: 'refunded', finishedAt: nowIso() })
    .where(eq(generationJobs.id, job.id));
  if (job.kind === 'lesson')
    await db
      .update(lessons)
      .set({ status: 'outline', body: null })
      .where(eq(lessons.id, job.refId));
  if (job.kind === 'roadmap')
    await db
      .delete(paths)
      .where(and(eq(paths.id, job.refId), eq(paths.status, 'draft')));
  if (job.kind === 'quiz') {
    const questions = await db
      .select({ id: quizQuestions.id })
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, job.refId))
      .limit(1);
    if (!questions[0])
      await db.delete(quizzes).where(eq(quizzes.id, job.refId));
  }
  await env.APP_KV.delete(lockKey(job.userId));
  logEvent({
    message: 'generation_refunded',
    jobId: job.id,
    userId: job.userId,
    errorCode: 'refunded',
    status: 'failed',
  });
}

async function clearStaleLock(
  env: Env,
  db: Database,
  userId: string,
): Promise<void> {
  const lock = await env.APP_KV.get(lockKey(userId));
  if (!lock) return;
  try {
    await requireActiveJobClear(db, userId);
  } catch {
    return;
  }
  await env.APP_KV.delete(lockKey(userId));
}

export async function adminRequeueGenerationJob(
  env: Env,
  db: Database,
  jobId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  const job = rows[0];
  if (job?.status !== 'failed') throw new AppError('validation');
  await clearStaleLock(env, db, job.userId);
  await requireActiveJobClear(db, job.userId);

  if (job.errorCode === 'refunded') {
    const config = await loadConfig(db);
    const cost =
      job.kind === 'roadmap'
        ? config.costRoadmap
        : job.kind === 'lesson'
          ? config.costLesson
          : config.costQuiz;
    const reason: 'roadmap' | 'lesson' | 'quiz' =
      job.kind === 'roadmap'
        ? 'roadmap'
        : job.kind === 'lesson'
          ? 'lesson'
          : 'quiz';
    const debited = await debitIfEnough(db, {
      userId: job.userId,
      amount: -cost,
      reason,
      refType: 'job',
      refId: job.id,
      idempotencyKey: `admin-requeue:${job.id}`,
    });
    if (debited === 'insufficient') throw new AppError('insufficient_credits');
  }

  await db
    .update(generationJobs)
    .set({
      status: 'queued',
      errorCode: null,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
    })
    .where(eq(generationJobs.id, job.id));
  await env.APP_KV.put(lockKey(job.userId), job.id, {
    expirationTtl: JOB_LOCK_TTL_SECONDS,
  });
  await enqueue(env, db, {
    id: job.id,
    userId: job.userId,
    kind: job.kind,
    refId: job.refId,
  });
  logEvent({
    message: 'admin_job_requeued',
    jobId: job.id,
    userId: job.userId,
  });
}

function lockKey(userId: string): string {
  return `lock:job:${userId}`;
}
