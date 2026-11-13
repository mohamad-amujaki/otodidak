import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { chapters, lessons, paths } from '../db/schema';

export async function ownedLesson(
  db: Database,
  userId: string,
  lessonId: string,
) {
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
