import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { paths } from '../db/schema';
import { AppError } from '../domain/errors';
import { nowIso } from '../domain/time';

export async function activateUserPath(
  db: Database,
  userId: string,
  pathId: string,
): Promise<void> {
  const rows = await db
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
  if (!rows[0]) throw new AppError('not_found');
  await db.batch([
    db.update(paths).set({ isActive: 0 }).where(eq(paths.userId, userId)),
    db
      .update(paths)
      .set({ isActive: 1, updatedAt: nowIso() })
      .where(eq(paths.id, rows[0].id)),
  ]);
}
