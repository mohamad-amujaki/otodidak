import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  chapters,
  lessonClaims,
  lessonSources,
  lessons,
  paths,
} from '../db/schema';
import { AppError } from '../domain/errors';
import type { Outline } from '../domain/outline';
import { pathOutlineSchema } from '../domain/schemas';
import { nowIso } from '../domain/time';
import { loadConfig, requireActiveJobClear } from './account';

export async function saveOutline(
  db: Database,
  userId: string,
  pathId: string,
  input: unknown,
): Promise<void> {
  const parsed = pathOutlineSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      'validation',
      parsed.error.issues[0]?.message ?? 'Periksa lagi kerangka.',
    );
  const outline = parsed.data satisfies Outline;
  const config = await loadConfig(db);
  if (outline.chapters.length > config.maxChapters)
    throw new AppError(
      'validation',
      'Batas bab pada jalur ini sudah tercapai.',
    );
  if (
    outline.chapters.some(
      (chapter) => chapter.lessons.length > config.maxLessonsPerChapter,
    )
  ) {
    throw new AppError(
      'validation',
      'Batas pelajaran pada bab ini sudah tercapai.',
    );
  }
  await requireActiveJobClear(db, userId);
  const pathRows = await db
    .select()
    .from(paths)
    .where(
      and(
        eq(paths.id, pathId),
        eq(paths.userId, userId),
        eq(paths.status, 'ready'),
      ),
    )
    .limit(1);
  const path = pathRows[0];
  if (!path) throw new AppError('not_found');
  const existingChapters = await db
    .select()
    .from(chapters)
    .where(eq(chapters.pathId, pathId));
  const existingLessons = [];
  for (const chapter of existingChapters) {
    const rows = await db
      .select()
      .from(lessons)
      .where(eq(lessons.chapterId, chapter.id));
    existingLessons.push(...rows);
  }
  const knownChapters = new Set(existingChapters.map((chapter) => chapter.id));
  const knownLessons = new Map(
    existingLessons.map((lesson) => [lesson.id, lesson]),
  );
  for (const chapter of outline.chapters) {
    if (chapter.id && !knownChapters.has(chapter.id))
      throw new AppError('validation', 'Bab tidak ditemukan.');
    for (const lesson of chapter.lessons) {
      if (lesson.id && !knownLessons.has(lesson.id))
        throw new AppError('validation', 'Pelajaran tidak ditemukan.');
    }
  }
  const keptLessons = new Set(
    outline.chapters.flatMap((chapter) =>
      chapter.lessons.flatMap((lesson) => (lesson.id ? [lesson.id] : [])),
    ),
  );
  for (const lesson of existingLessons) {
    if (!keptLessons.has(lesson.id) && lesson.status === 'queued')
      throw new AppError('generation_in_progress');
  }
  const keptChapters = new Set(
    outline.chapters.flatMap((chapter) => (chapter.id ? [chapter.id] : [])),
  );
  for (const lesson of existingLessons) {
    if (keptLessons.has(lesson.id)) continue;
    await db.delete(lessonClaims).where(eq(lessonClaims.lessonId, lesson.id));
    await db.delete(lessonSources).where(eq(lessonSources.lessonId, lesson.id));
    await db.delete(lessons).where(eq(lessons.id, lesson.id));
  }
  for (const chapter of existingChapters) {
    if (keptChapters.has(chapter.id)) continue;
    await db.delete(chapters).where(eq(chapters.id, chapter.id));
  }
  for (const [chapterIndex, chapter] of outline.chapters.entries()) {
    const chapterId = chapter.id ?? crypto.randomUUID();
    if (chapter.id) {
      await db
        .update(chapters)
        .set({
          title: chapter.title,
          summary: chapter.summary,
          position: chapterIndex,
        })
        .where(eq(chapters.id, chapterId));
    } else {
      await db.insert(chapters).values({
        id: chapterId,
        pathId,
        position: chapterIndex,
        title: chapter.title,
        summary: chapter.summary,
        quizStatus: 'unchecked',
      });
    }
    for (const [lessonIndex, lesson] of chapter.lessons.entries()) {
      if (lesson.id) {
        await db
          .update(lessons)
          .set({
            title: lesson.title,
            objective: lesson.objective,
            position: lessonIndex,
            chapterId,
          })
          .where(eq(lessons.id, lesson.id));
      } else {
        await db.insert(lessons).values({
          id: crypto.randomUUID(),
          chapterId,
          position: lessonIndex,
          title: lesson.title,
          objective: lesson.objective,
          body: null,
          status: 'outline',
          completedAt: null,
          createdAt: nowIso(),
        });
      }
    }
  }
  await db
    .update(paths)
    .set({ title: outline.title, updatedAt: nowIso() })
    .where(eq(paths.id, pathId));
}
