import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  chapters,
  generationJobs,
  lessonClaims,
  lessonSources,
  lessons,
  paths,
  quizAttempts,
  quizQuestions,
  quizzes,
  type UserRow,
  users,
} from '../db/schema';
import { MAX_QUIZ_ATTEMPT_HISTORY } from '../domain/defaults';
import { quizStatusLabel } from '../domain/format';
import { streakSentences } from '../domain/streak';
import { jakartaDate } from '../domain/time';
import { balanceOf, loadConfig } from './account';

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    streakEnabled: user.streakEnabled === 1,
    streakCount: user.streakCount,
    deletionRequestedAt: user.deletionRequestedAt,
  };
}

function publicConfig(config: Awaited<ReturnType<typeof loadConfig>>) {
  return {
    costRoadmap: config.costRoadmap,
    costLesson: config.costLesson,
    costQuiz: config.costQuiz,
    lessonMinuteLabel: config.lessonMinuteLabel,
    signupCredits: config.signupCredits,
    maxChapters: config.maxChapters,
    maxLessonsPerChapter: config.maxLessonsPerChapter,
    passThreshold: config.quizPassPercent,
  };
}

/** Nama, saldo, dan biaya. Dipakai Shell dan halaman yang tidak menyusun dasbor. */
export async function shellPayload(db: Database, user: UserRow) {
  const [balance, config] = await Promise.all([
    balanceOf(db, user.id),
    loadConfig(db),
  ]);
  return { user: publicUser(user), balance, config: publicConfig(config) };
}

export async function currentJob(db: Database, userId: string) {
  const rows = await db
    .select({
      id: generationJobs.id,
      kind: generationJobs.kind,
      status: generationJobs.status,
      refId: generationJobs.refId,
    })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.userId, userId),
        inArray(generationJobs.status, ['queued', 'running']),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function mePayload(db: Database, user: UserRow) {
  const today = jakartaDate(new Date());
  const failureCutoff = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const [balance, config, active, activeJob, failedRows, earlier] =
    await Promise.all([
      balanceOf(db, user.id),
      loadConfig(db),
      db
        .select()
        .from(paths)
        .where(
          and(
            eq(paths.userId, user.id),
            eq(paths.isActive, 1),
            eq(paths.status, 'ready'),
          ),
        )
        .limit(1),
      currentJob(db, user.id),
      db
        .select({
          id: generationJobs.id,
          kind: generationJobs.kind,
          refId: generationJobs.refId,
          errorCode: generationJobs.errorCode,
          errorDetail: generationJobs.errorDetail,
          createdAt: generationJobs.createdAt,
        })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.userId, user.id),
            eq(generationJobs.status, 'failed'),
            gte(generationJobs.createdAt, failureCutoff),
          ),
        )
        .orderBy(desc(generationJobs.createdAt))
        .limit(1),
      hasEarlierCompletion(db, user.id, today),
    ]);
  const path = active[0] ?? null;
  const next = path ? await nextLesson(db, path.id) : null;
  const failedJob = failedRows[0] ?? null;
  return {
    user: publicUser(user),
    balance,
    streak:
      user.streakEnabled === 1
        ? {
            count: user.streakCount,
            lines: streakSentences({
              enabled: true,
              count: user.streakCount,
              lastDate: user.streakLastDate,
              freezeWeek: user.streakFreezeWeek,
              today,
              hasEarlierCompletion: earlier,
            }),
          }
        : null,
    activePath: path
      ? { id: path.id, title: path.title, topic: path.topic, nextLesson: next }
      : null,
    activeJob: activeJob
      ? {
          id: activeJob.id,
          kind: activeJob.kind,
          status: activeJob.status,
          refId: activeJob.refId,
        }
      : null,
    failedJob: failedJob
      ? {
          id: failedJob.id,
          kind: failedJob.kind,
          refId: failedJob.refId,
          errorCode: failedJob.errorCode,
          errorDetail: failedJob.errorDetail,
          createdAt: failedJob.createdAt,
        }
      : null,
    config: publicConfig(config),
  };
}

export async function library(db: Database, userId: string) {
  const rows = await db
    .select({
      id: paths.id,
      title: paths.title,
      topic: paths.topic,
      isActive: paths.isActive,
      updatedAt: paths.updatedAt,
    })
    .from(paths)
    .where(and(eq(paths.userId, userId), eq(paths.status, 'ready')))
    .orderBy(desc(paths.updatedAt));
  if (rows.length === 0) return [];
  const progressRows = await db
    .select({
      pathId: chapters.pathId,
      total: count(lessons.id),
      done: sql<number>`count(${lessons.completedAt})`,
    })
    .from(chapters)
    .innerJoin(lessons, eq(lessons.chapterId, chapters.id))
    .where(
      inArray(
        chapters.pathId,
        rows.map((path) => path.id),
      ),
    )
    .groupBy(chapters.pathId);
  const progressByPath = new Map(
    progressRows.map((row) => [
      row.pathId,
      { done: Number(row.done), total: Number(row.total) },
    ]),
  );
  return rows.map((path) => ({
    id: path.id,
    title: path.title,
    topic: path.topic,
    isActive: path.isActive === 1,
    progress: progressByPath.get(path.id) ?? { done: 0, total: 0 },
    updatedAt: path.updatedAt,
  }));
}

export async function pathDetail(db: Database, userId: string, pathId: string) {
  const rows = await db
    .select()
    .from(paths)
    .where(and(eq(paths.id, pathId), eq(paths.userId, userId)))
    .limit(1);
  const path = rows[0];
  if (!path || path.status === 'archived') return null;
  const chapterRows = await db
    .select({
      id: chapters.id,
      title: chapters.title,
      summary: chapters.summary,
      position: chapters.position,
      quizStatus: chapters.quizStatus,
    })
    .from(chapters)
    .where(eq(chapters.pathId, path.id))
    .orderBy(asc(chapters.position));
  const chapterIds = chapterRows.map((chapter) => chapter.id);
  const [lessonRows, quizRows] = await Promise.all([
    chapterIds.length > 0
      ? db
          .select({
            id: lessons.id,
            chapterId: lessons.chapterId,
            title: lessons.title,
            objective: lessons.objective,
            position: lessons.position,
            status: lessons.status,
            quizStatus: lessons.quizStatus,
            completedAt: lessons.completedAt,
            hasBody: sql<number>`case when ${lessons.body} is not null then 1 else 0 end`,
          })
          .from(lessons)
          .where(inArray(lessons.chapterId, chapterIds))
          .orderBy(asc(lessons.position))
      : Promise.resolve([]),
    chapterIds.length > 0
      ? db
          .select({
            id: quizzes.id,
            chapterId: quizzes.chapterId,
            lessonId: quizzes.lessonId,
          })
          .from(quizzes)
          .where(inArray(quizzes.chapterId, chapterIds))
          .orderBy(desc(quizzes.createdAt))
      : Promise.resolve([]),
  ]);
  const latestQuizByLesson = new Map<string, string>();
  for (const quiz of quizRows) {
    if (quiz.lessonId && !latestQuizByLesson.has(quiz.lessonId))
      latestQuizByLesson.set(quiz.lessonId, quiz.id);
  }
  const lessonsByChapter = groupBy(lessonRows, (lesson) => lesson.chapterId);
  const chapterPayload = chapterRows.map((chapter) => {
    const lessons = (lessonsByChapter.get(chapter.id) ?? []).map((lesson) => {
      const quizId = latestQuizByLesson.get(lesson.id);
      const quiz = quizId ? { id: quizId } : null;
      return {
        id: lesson.id,
        title: lesson.title,
        objective: lesson.objective,
        position: lesson.position,
        status: lesson.status,
        quizStatus: lesson.quizStatus,
        quizStatusLabel: quizStatusLabel(lesson.quizStatus),
        quiz,
        hasBody: lesson.hasBody === 1 && lesson.status === 'ready',
        completedAt: lesson.completedAt,
      };
    });
    const quizzed = lessons.filter((lesson) => lesson.quiz !== null);
    const quizCount = quizzed.length;
    const quizPassed = quizzed.filter(
      (lesson) => lesson.quizStatus === 'understood',
    ).length;
    const quizStatus =
      quizCount === 0
        ? ('unchecked' as const)
        : quizPassed === quizCount
          ? ('understood' as const)
          : quizzed.some((lesson) => lesson.quizStatus === 'retry')
            ? ('retry' as const)
            : ('unchecked' as const);
    return {
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      position: chapter.position,
      quizStatus,
      quizStatusLabel: quizStatusLabel(quizStatus),
      quizCount,
      quizPassed,
      lessons,
    };
  });
  const progress = {
    done: lessonRows.filter((lesson) => lesson.completedAt).length,
    total: lessonRows.length,
  };
  return {
    id: path.id,
    title: path.title,
    topic: path.topic,
    status: path.status,
    isActive: path.isActive === 1,
    progress,
    chapters: chapterPayload,
  };
}

type LessonRow = typeof lessons.$inferSelect;

export async function lessonView(db: Database, lesson: LessonRow) {
  const [sources, claims] = await Promise.all([
    db
      .select()
      .from(lessonSources)
      .where(eq(lessonSources.lessonId, lesson.id))
      .orderBy(asc(lessonSources.position)),
    db.select().from(lessonClaims).where(eq(lessonClaims.lessonId, lesson.id)),
  ]);
  return {
    id: lesson.id,
    title: lesson.title,
    objective: lesson.objective,
    body: lesson.body,
    status: lesson.status,
    completedAt: lesson.completedAt,
    sources: sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      url: source.url,
      title: source.title,
    })),
    claims: claims.map((claim) => ({
      quote: claim.quote,
      unsourced: claim.unsourced === 1,
    })),
  };
}

export async function lessonContent(db: Database, lessonId: string) {
  const rows = await db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  const lesson = rows[0];
  if (!lesson) return null;
  return lessonView(db, lesson);
}

type QuizPayload = {
  id: string;
  questions: {
    id: string;
    position: number;
    stem: string;
    choices: string[];
    selected: number | null;
    correctIndex: number | null;
    explanation: string | null;
  }[];
  attempt: {
    id: string;
    scorePercent: number;
    createdAt: string;
  } | null;
  attempts: { id: string; scorePercent: number; createdAt: string }[];
};

async function quizPayloadFor(
  db: Database,
  quizIds: string[],
): Promise<Map<string, QuizPayload>> {
  const payloads = new Map<string, QuizPayload>();
  if (quizIds.length === 0) return payloads;
  const [questions, attempts] = await Promise.all([
    db
      .select({
        id: quizQuestions.id,
        quizId: quizQuestions.quizId,
        position: quizQuestions.position,
        stem: quizQuestions.stem,
        choicesJson: quizQuestions.choicesJson,
        correctIndex: quizQuestions.correctIndex,
        explanation: quizQuestions.explanation,
      })
      .from(quizQuestions)
      .where(inArray(quizQuestions.quizId, quizIds))
      .orderBy(asc(quizQuestions.position)),
    db
      .select({
        id: quizAttempts.id,
        quizId: quizAttempts.quizId,
        scorePercent: quizAttempts.scorePercent,
        answersJson: quizAttempts.answersJson,
        createdAt: quizAttempts.createdAt,
      })
      .from(quizAttempts)
      .where(inArray(quizAttempts.quizId, quizIds))
      .orderBy(desc(quizAttempts.createdAt))
      .limit(quizIds.length * MAX_QUIZ_ATTEMPT_HISTORY),
  ]);
  const questionsByQuiz = groupBy(questions, (question) => question.quizId);
  const latestAttempt = new Map<string, (typeof attempts)[number]>();
  const attemptsByQuiz = new Map<
    string,
    { id: string; scorePercent: number; createdAt: string }[]
  >();
  for (const attempt of attempts) {
    if (!latestAttempt.has(attempt.quizId))
      latestAttempt.set(attempt.quizId, attempt);
    const history = attemptsByQuiz.get(attempt.quizId) ?? [];
    if (history.length < MAX_QUIZ_ATTEMPT_HISTORY)
      history.push({
        id: attempt.id,
        scorePercent: attempt.scorePercent,
        createdAt: attempt.createdAt,
      });
    attemptsByQuiz.set(attempt.quizId, history);
  }
  for (const [quizId, quizQuestionsForId] of questionsByQuiz) {
    if (quizQuestionsForId.length === 0) continue;
    const attempt = latestAttempt.get(quizId) ?? null;
    const answers = attempt ? parseAnswers(attempt.answersJson) : [];
    payloads.set(quizId, {
      id: quizId,
      questions: quizQuestionsForId.map((question, index) => ({
        id: question.id,
        position: question.position,
        stem: question.stem,
        choices: parseChoices(question.choicesJson),
        selected: answers[index] ?? null,
        correctIndex: attempt ? question.correctIndex : null,
        explanation:
          attempt && answers[index] !== question.correctIndex
            ? question.explanation
            : null,
      })),
      attempt: attempt
        ? {
            id: attempt.id,
            scorePercent: attempt.scorePercent,
            createdAt: attempt.createdAt,
          }
        : null,
      attempts: attemptsByQuiz.get(quizId) ?? [],
    });
  }
  return payloads;
}

export async function lessonQuiz(db: Database, lessonId: string) {
  const rows = await db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .orderBy(desc(quizzes.createdAt))
    .limit(1);
  const quiz = rows[0];
  if (!quiz) return null;
  const payloads = await quizPayloadFor(db, [quiz.id]);
  return payloads.get(quiz.id) ?? null;
}

export async function latestQuizScore(
  db: Database,
  lessonId: string,
): Promise<number | null> {
  const row = await db.get<{ score: number | null }>(sql`
    select quiz_attempt.score_percent as score
    from quiz
    inner join quiz_attempt on quiz_attempt.quiz_id = quiz.id
    where quiz.lesson_id = ${lessonId}
    order by quiz_attempt.created_at desc
    limit 1
  `);
  return row ? Number(row.score) : null;
}

async function nextLesson(db: Database, pathId: string) {
  const row = await db.get<{
    id: string;
    title: string;
    chapterTitle: string;
  }>(sql`
    select lesson.id as id, lesson.title as title, chapter.title as chapterTitle
    from chapter
    inner join lesson on lesson.chapter_id = chapter.id
    where chapter.path_id = ${pathId} and lesson.completed_at is null
    order by chapter.position, lesson.position
    limit 1
  `);
  if (!row) return null;
  return { id: row.id, title: row.title, chapterTitle: row.chapterTitle };
}

async function hasEarlierCompletion(
  db: Database,
  userId: string,
  today: string,
): Promise<boolean> {
  const row = await db.get<{ first: string | null }>(sql`
    select min(lesson.completed_at) as first
    from lesson
    inner join chapter on lesson.chapter_id = chapter.id
    inner join path on chapter.path_id = path.id
    where path.user_id = ${userId} and lesson.completed_at is not null
  `);
  if (!row?.first) return false;
  return jakartaDate(new Date(row.first)) < today;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const value = key(row);
    const group = groups.get(value);
    if (group) group.push(row);
    else groups.set(value, [row]);
  }
  return groups;
}

function parseChoices(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    )
      return parsed;
  } catch {
    return [];
  }
  return [];
}

function parseAnswers(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'number')
    )
      return parsed;
  } catch {
    return [];
  }
  return [];
}

export async function userById(db: Database, userId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}
