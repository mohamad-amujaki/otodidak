import { and, asc, desc, eq } from 'drizzle-orm';
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
    .select()
    .from(paths)
    .where(and(eq(paths.userId, userId), eq(paths.status, 'ready')))
    .orderBy(desc(paths.updatedAt));
  const items = [];
  for (const path of rows) {
    const progress = await progressFor(db, path.id);
    items.push({
      id: path.id,
      title: path.title,
      topic: path.topic,
      isActive: path.isActive === 1,
      progress,
      updatedAt: path.updatedAt,
    });
  }
  return items;
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
    .select()
    .from(chapters)
    .where(eq(chapters.pathId, path.id))
    .orderBy(asc(chapters.position));
  const chapterPayload = [];
  for (const chapter of chapterRows) {
    const lessonRows = await db
      .select()
      .from(lessons)
      .where(eq(lessons.chapterId, chapter.id))
      .orderBy(asc(lessons.position));
    const quizRows = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.chapterId, chapter.id))
      .orderBy(desc(quizzes.createdAt));
    const quiz = await quizPayload(
      db,
      quizRows.map((item) => item.id),
    );
    chapterPayload.push({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      position: chapter.position,
      quizStatus: chapter.quizStatus,
      quizStatusLabel: quizStatusLabel(chapter.quizStatus),
      quiz,
      lessons: lessonRows.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        objective: lesson.objective,
        position: lesson.position,
        status: lesson.status,
        hasBody: lesson.body !== null && lesson.status === 'ready',
        completedAt: lesson.completedAt,
      })),
    });
  }
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

async function quizPayload(db: Database, quizIds: string[]) {
  for (const quizId of quizIds) {
    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(asc(quizQuestions.position));
    if (questions.length === 0) continue;
    const attempts = await db
      .select()
      .from(quizAttempts)
      .where(eq(quizAttempts.quizId, quizId))
      .orderBy(desc(quizAttempts.createdAt))
      .limit(1);
    const attempt = attempts[0] ?? null;
    const answers = attempt ? parseAnswers(attempt.answersJson) : [];
    return {
      id: quizId,
      questions: questions.map((question, index) => ({
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
    };
  }
  return null;
}

async function progressFor(db: Database, pathId: string) {
  const chapterRows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.pathId, pathId));
  let total = 0;
  let done = 0;
  for (const chapter of chapterRows) {
    const lessonRows = await db
      .select({ completedAt: lessons.completedAt })
      .from(lessons)
      .where(eq(lessons.chapterId, chapter.id));
    total += lessonRows.length;
    done += lessonRows.filter((lesson) => lesson.completedAt).length;
  }
  return { done, total };
}

async function nextLesson(db: Database, pathId: string) {
  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.pathId, pathId))
    .orderBy(asc(chapters.position));
  for (const chapter of chapterRows) {
    const lessonRows = await db
      .select()
      .from(lessons)
      .where(eq(lessons.chapterId, chapter.id))
      .orderBy(asc(lessons.position));
    const lesson = lessonRows.find((item) => !item.completedAt);
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
  const pathRows = await db
    .select({ id: paths.id })
    .from(paths)
    .where(eq(paths.userId, userId));
  const dates = new Set<string>();
  for (const path of pathRows) {
    const chapterRows = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(eq(chapters.pathId, path.id));
    for (const chapter of chapterRows) {
      const lessonRows = await db
        .select({ completedAt: lessons.completedAt })
        .from(lessons)
        .where(eq(lessons.chapterId, chapter.id));
      for (const lesson of lessonRows) {
        if (lesson.completedAt)
          dates.add(jakartaDate(new Date(lesson.completedAt)));
      }
    }
  }
  return [...dates];
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
