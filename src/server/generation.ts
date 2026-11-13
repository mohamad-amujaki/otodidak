import { and, eq } from 'drizzle-orm';
import {
  completeJson,
  loadModel,
  ModelError,
  parseModelOutput,
} from '../ai/generate';
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
  MAX_WEB_SOURCES,
  QUEUE_MAX_ATTEMPTS,
  QUIZ_SNIPPET_CHARS,
} from '../domain/defaults';
import { AppError } from '../domain/errors';
import type {
  LessonOutput,
  QuizOutput,
  RoadmapOutput,
} from '../domain/schemas';
import { nowIso } from '../domain/time';
import { searchWeb, searchYouTube } from '../sources/search';
import { database, loadConfig, requireActiveJobClear } from './account';
import { logEvent } from './log';
import { allowGenerateIp, jobsWithinLimit, recordJob } from './rate';

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
    await db
      .update(generationJobs)
      .set({ status: 'succeeded', errorCode: null, finishedAt: nowIso() })
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
    logEvent({
      message: 'generation_failed',
      jobId: job.id,
      userId: job.userId,
      errorCode,
      status: String(attempt),
    });
    if (attempt >= QUEUE_MAX_ATTEMPTS) {
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
  if (!(await jobsWithinLimit(env.APP_KV, user.id)))
    throw new AppError('rate_limited');
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
  await recordJob(env.APP_KV, user.id);
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
    title: context.title,
    objective: context.objective,
    neighbors: context.neighbors,
  });
  if (!isLesson(output)) throw new ModelError('invalid_output');
  if (output.markdown.length > 100_000) throw new ModelError('invalid_output');
  const claims = output.claims.slice(0, 8);
  const sources: {
    id: string;
    kind: 'web' | 'youtube';
    url: string;
    title: string;
  }[] = [];
  const claimRows: {
    quote: string;
    unsourced: number;
    sourceId: string | null;
  }[] = [];
  let searchFailed = false;
  for (const [index, claim] of claims.entries()) {
    if (searchFailed || index >= MAX_WEB_SOURCES) {
      claimRows.push({ quote: claim.quote, unsourced: 1, sourceId: null });
      continue;
    }
    try {
      const hits = await searchWeb(env, db, claim.search_query);
      const hit = hits.find((item) => item.url.startsWith('https://'));
      if (
        hit &&
        sources.filter((item) => item.kind === 'web').length < MAX_WEB_SOURCES
      ) {
        const sourceId = crypto.randomUUID();
        sources.push({
          id: sourceId,
          kind: 'web',
          url: hit.url,
          title: hit.title,
        });
        claimRows.push({ quote: claim.quote, unsourced: 0, sourceId });
      } else {
        claimRows.push({ quote: claim.quote, unsourced: 1, sourceId: null });
      }
    } catch {
      searchFailed = true;
      claimRows.push({ quote: claim.quote, unsourced: 1, sourceId: null });
    }
  }
  if (searchFailed) {
    for (const row of claimRows) {
      row.unsourced = 1;
      row.sourceId = null;
    }
    sources.splice(0, sources.length);
  }
  try {
    const video = await searchYouTube(
      env,
      db,
      `${context.title} ${context.topic}`,
    );
    if (video?.url.startsWith('https://'))
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
  for (const claim of claimRows) {
    await db.insert(lessonClaims).values({
      id: crypto.randomUUID(),
      lessonId,
      quote: claim.quote,
      unsourced: claim.unsourced,
      sourceId: claim.sourceId,
    });
  }
  await db
    .update(lessons)
    .set({ body: output.markdown, status: 'ready' })
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
  const raw = await completeJson(env, model, input, task);
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
  const ordered: { title: string }[] = [];
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
      ordered.push({ title: entry.title });
  }
  const index = ordered.findIndex((item) => item.title === lesson.title);
  const neighbors = [
    ordered[index - 1]?.title,
    ordered[index + 1]?.title,
  ].filter((item): item is string => Boolean(item));
  return {
    pathTitle: path.title,
    topic: path.topic,
    chapterTitle: chapter.title,
    title: lesson.title,
    objective: lesson.objective,
    neighbors,
  };
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

function lockKey(userId: string): string {
  return `lock:job:${userId}`;
}
