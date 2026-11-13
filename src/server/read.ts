import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
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
import { quizStatusLabel } from '../domain/format';
import { streakSentences } from '../domain/streak';
import { jakartaDate } from '../domain/time';
import { balanceOf, loadConfig } from './account';

export async function mePayload(db: Database, user: UserRow) {
  const balance = await balanceOf(db, user.id);
  const config = await loadConfig(db);
  const today = jakartaDate(new Date());
  const active = await db
    .select()
    .from(paths)
    .where(
      and(
        eq(paths.userId, user.id),
        eq(paths.isActive, 1),
        eq(paths.status, 'ready'),
      ),
    )
    .limit(1);
  const path = active[0] ?? null;
  const next = path ? await nextLesson(db, path.id) : null;
  const jobs = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.userId, user.id))
    .orderBy(desc(generationJobs.createdAt))
    .limit(5);
  const activeJob =
    jobs.find((job) => job.status === 'queued' || job.status === 'running') ??
    null;
  const failedJob = jobs.find((job) => job.status === 'failed') ?? null;
  const completed = await completedDates(db, user.id);
  const earlier = completed.some((date) => date < today);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      streakEnabled: user.streakEnabled === 1,
      deletionRequestedAt: user.deletionRequestedAt,
    },
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
        }
      : null,
    config: {
      costRoadmap: config.costRoadmap,
      costLesson: config.costLesson,
      costQuiz: config.costQuiz,
      lessonMinuteLabel: config.lessonMinuteLabel,
      signupCredits: config.signupCredits,
    },
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
            completedAt: lessons.completedAt,
            hasBody: sql<number>`case when ${lessons.body} is not null then 1 else 0 end`,
          })
          .from(lessons)
          .where(inArray(lessons.chapterId, chapterIds))
          .orderBy(asc(lessons.position))
      : Promise.resolve([]),
    chapterIds.length > 0
      ? db
          .select({ id: quizzes.id, chapterId: quizzes.chapterId })
          .from(quizzes)
          .where(inArray(quizzes.chapterId, chapterIds))
          .orderBy(desc(quizzes.createdAt))
      : Promise.resolve([]),
  ]);
  const quizPayloads = await quizPayloadFor(
    db,
    quizRows.map((quiz) => quiz.id),
  );
  const lessonsByChapter = groupBy(lessonRows, (lesson) => lesson.chapterId);
  const quizIdsByChapter = groupBy(quizRows, (quiz) => quiz.chapterId);
  const chapterPayload = chapterRows.map((chapter) => {
    const quizzesForChapter = quizIdsByChapter.get(chapter.id) ?? [];
    const quiz =
      quizzesForChapter
        .map((quiz) => quizPayloads.get(quiz.id))
        .find((payload) => payload !== undefined) ?? null;
    return {
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      position: chapter.position,
      quizStatus: chapter.quizStatus,
      quizStatusLabel: quizStatusLabel(chapter.quizStatus),
      quiz,
      lessons: (lessonsByChapter.get(chapter.id) ?? []).map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        objective: lesson.objective,
        position: lesson.position,
        status: lesson.status,
        hasBody: lesson.hasBody === 1 && lesson.status === 'ready',
        completedAt: lesson.completedAt,
      })),
    };
  });
  const progress = await progressFor(db, path.id);
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

export async function lessonContent(db: Database, lessonId: string) {
  const rows = await db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  const lesson = rows[0];
  if (!lesson) return null;
  const sources = await db
    .select()
    .from(lessonSources)
    .where(eq(lessonSources.lessonId, lessonId))
    .orderBy(asc(lessonSources.position));
  const claims = await db
    .select()
    .from(lessonClaims)
    .where(eq(lessonClaims.lessonId, lessonId));
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
      .orderBy(desc(quizAttempts.createdAt)),
  ]);
  const questionsByQuiz = groupBy(questions, (question) => question.quizId);
  const latestAttempt = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (!latestAttempt.has(attempt.quizId))
      latestAttempt.set(attempt.quizId, attempt);
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
    });
  }
  return payloads;
}

async function progressFor(db: Database, pathId: string) {
  const rows = await db
    .select({
      total: count(lessons.id),
      done: sql<number>`count(${lessons.completedAt})`,
    })
    .from(lessons)
    .innerJoin(chapters, eq(lessons.chapterId, chapters.id))
    .where(eq(chapters.pathId, pathId));
  return {
    done: Number(rows[0]?.done ?? 0),
    total: Number(rows[0]?.total ?? 0),
  };
}

async function nextLesson(db: Database, pathId: string) {
  const chapterRows = await db
    .select({ id: chapters.id, title: chapters.title })
    .from(chapters)
    .where(eq(chapters.pathId, pathId))
    .orderBy(asc(chapters.position));
  if (chapterRows.length === 0) return null;
  const lessonRows = await db
    .select({
      id: lessons.id,
      chapterId: lessons.chapterId,
      title: lessons.title,
      completedAt: lessons.completedAt,
    })
    .from(lessons)
    .where(
      inArray(
        lessons.chapterId,
        chapterRows.map((chapter) => chapter.id),
      ),
    )
    .orderBy(asc(lessons.position));
  const lessonsByChapter = groupBy(lessonRows, (lesson) => lesson.chapterId);
  for (const chapter of chapterRows) {
    const lesson = (lessonsByChapter.get(chapter.id) ?? []).find(
      (item) => !item.completedAt,
    );
    if (lesson)
      return {
        id: lesson.id,
        title: lesson.title,
        chapterTitle: chapter.title,
      };
  }
  return null;
}

async function completedDates(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ completedAt: lessons.completedAt })
    .from(lessons)
    .innerJoin(chapters, eq(lessons.chapterId, chapters.id))
    .innerJoin(paths, eq(chapters.pathId, paths.id))
    .where(
      and(eq(paths.userId, userId), sql`${lessons.completedAt} is not null`),
    );
  const dates = new Set<string>();
  for (const lesson of rows) {
    if (lesson.completedAt)
      dates.add(jakartaDate(new Date(lesson.completedAt)));
  }
  return [...dates];
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
