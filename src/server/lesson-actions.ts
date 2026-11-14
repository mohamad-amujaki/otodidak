import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { lessons, type UserRow, users } from '../db/schema';
import { AppError } from '../domain/errors';
import { applyStreak } from '../domain/streak';
import { jakartaDate, nowIso } from '../domain/time';
import { ownedLesson } from './owned';
import { lessonContent } from './read';

export async function lessonForUser(
  db: Database,
  userId: string,
  lessonId: string,
) {
  const owned = await ownedLesson(db, userId, lessonId);
  if (!owned) throw new AppError('not_found');
  const content = await lessonContent(db, lessonId);
  if (!content) throw new AppError('not_found');
  return content;
}

export async function completeLesson(
  db: Database,
  user: UserRow,
  lessonId: string,
) {
  const detail = await ownedLesson(db, user.id, lessonId);
  if (!detail) throw new AppError('not_found');
  if (detail.status !== 'ready' || !detail.body)
    throw new AppError('validation', 'Pelajaran belum siap.');
  if (detail.completedAt)
    return {
      completedAt: detail.completedAt,
      streakCount: user.streakCount,
    };
  const today = jakartaDate(new Date());
  const streak = applyStreak(
    {
      enabled: user.streakEnabled === 1,
      count: user.streakCount,
      lastDate: user.streakLastDate,
      freezeWeek: user.streakFreezeWeek,
    },
    today,
  );
  const completedAt = nowIso();
  await db
    .update(lessons)
    .set({ completedAt })
    .where(eq(lessons.id, detail.id));
  if (streak.changed) {
    await db
      .update(users)
      .set({
        streakCount: streak.count,
        streakLastDate: streak.lastDate,
        streakFreezeWeek: streak.freezeWeek,
        updatedAt: completedAt,
      })
      .where(eq(users.id, user.id));
  }
  return {
    completedAt,
    streakCount: streak.count,
    freezeUsedNow: streak.freezeUsedNow,
    restarted: streak.restarted,
  };
}
