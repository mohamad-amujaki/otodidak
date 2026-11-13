import { and, count, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { balanceOf, insertLedger } from '../billing/ledger';
import { createDb, type Database } from '../db/client';
import {
  type AppConfigRow,
  appConfig,
  chapters,
  creditLedger,
  creditOrders,
  creditPacks,
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
import { ensureSeed } from '../db/seed';
import { AppError } from '../domain/errors';
import { nowIso } from '../domain/time';
import type { Identity } from './auth';

export async function database(env: Env): Promise<Database> {
  const db = createDb(env.DB);
  await ensureSeed(db);
  return db;
}

export async function loadConfig(db: Database): Promise<AppConfigRow> {
  const rows = await db.select().from(appConfig).limit(1);
  const row = rows[0];
  if (!row) throw new AppError('not_found');
  return row;
}

export async function ensureUser(
  db: Database,
  env: Env,
  identity: Identity,
): Promise<UserRow> {
  const now = nowIso();
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, identity.clerkUserId))
    .limit(1);
  const found = existing[0];
  if (found) {
    if (found.email !== identity.email || found.name !== identity.name) {
      await db
        .update(users)
        .set({ email: identity.email, name: identity.name, updatedAt: now })
        .where(eq(users.id, found.id));
      return {
        ...found,
        email: identity.email,
        name: identity.name,
        updatedAt: now,
      };
    }
    return found;
  }
  const config = await loadConfig(db);
  const role =
    identity.email.toLowerCase() === env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
      ? 'admin'
      : 'learner';
  const id = crypto.randomUUID();
  try {
    await db.insert(users).values({
      id,
      clerkUserId: identity.clerkUserId,
      email: identity.email,
      name: identity.name,
      role,
      status: 'active',
      streakEnabled: 1,
      streakCount: 0,
      streakLastDate: null,
      streakFreezeWeek: null,
      deletionRequestedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    const again = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, identity.clerkUserId))
      .limit(1);
    if (!again[0]) throw new AppError('forbidden');
    return again[0];
  }
  if (config.signupCredits > 0) {
    await insertLedger(db, {
      userId: id,
      amount: config.signupCredits,
      reason: 'signup_grant',
      refType: 'user',
      refId: id,
      idempotencyKey: `signup:${identity.clerkUserId}`,
    });
  }
  const created = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!created[0]) throw new AppError('forbidden');
  return created[0];
}

export async function requireActiveJobClear(
  db: Database,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.userId, userId),
        or(
          eq(generationJobs.status, 'queued'),
          eq(generationJobs.status, 'running'),
        ),
      ),
    )
    .limit(1);
  if (rows[0]) throw new AppError('generation_in_progress');
}

export async function eraseLearning(
  db: Database,
  userId: string,
): Promise<void> {
  const pathRows = await db
    .select({ id: paths.id })
    .from(paths)
    .where(eq(paths.userId, userId));
  for (const path of pathRows) await deletePath(db, path.id);
  const attemptRows = await db
    .select({ id: quizAttempts.id })
    .from(quizAttempts)
    .where(eq(quizAttempts.userId, userId));
  for (const attempt of attemptRows)
    await db.delete(quizAttempts).where(eq(quizAttempts.id, attempt.id));
  await db.delete(generationJobs).where(eq(generationJobs.userId, userId));
  await db
    .update(users)
    .set({ deletionRequestedAt: null, updatedAt: nowIso() })
    .where(eq(users.id, userId));
}

export async function deletePath(db: Database, pathId: string): Promise<void> {
  const chapterRows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.pathId, pathId));
  for (const chapter of chapterRows) {
    const lessonRows = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.chapterId, chapter.id));
    for (const lesson of lessonRows) {
      await db.delete(lessonClaims).where(eq(lessonClaims.lessonId, lesson.id));
      await db
        .delete(lessonSources)
        .where(eq(lessonSources.lessonId, lesson.id));
      await db.delete(lessons).where(eq(lessons.id, lesson.id));
    }
    const quizRows = await db
      .select({ id: quizzes.id })
      .from(quizzes)
      .where(eq(quizzes.chapterId, chapter.id));
    for (const quiz of quizRows) {
      await db.delete(quizAttempts).where(eq(quizAttempts.quizId, quiz.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.quizId, quiz.id));
      await db.delete(quizzes).where(eq(quizzes.id, quiz.id));
    }
    await db.delete(chapters).where(eq(chapters.id, chapter.id));
  }
  await db.delete(paths).where(eq(paths.id, pathId));
}

const usageReasons = ['roadmap', 'lesson', 'quiz', 'outline'] as const;

function ledgerReasonWhere(userId: string, reason?: string): SQL | undefined {
  if (!reason) return eq(creditLedger.userId, userId);
  if (reason === 'usage') {
    return and(
      eq(creditLedger.userId, userId),
      inArray(creditLedger.reason, [...usageReasons]),
    );
  }
  return and(
    eq(creditLedger.userId, userId),
    eq(
      creditLedger.reason,
      reason as (typeof creditLedger.$inferSelect)['reason'],
    ),
  );
}

function orderStatusWhere(userId: string, status?: string): SQL | undefined {
  if (!status) return eq(creditOrders.userId, userId);
  return and(
    eq(creditOrders.userId, userId),
    eq(
      creditOrders.status,
      status as (typeof creditOrders.$inferSelect)['status'],
    ),
  );
}

export async function ledgerPage(
  db: Database,
  userId: string,
  limit: number,
  offset: number,
  reason?: string,
) {
  if (limit < 1) return [];
  const where = ledgerReasonWhere(userId, reason);
  return db
    .select()
    .from(creditLedger)
    .where(where)
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function ledgerCount(
  db: Database,
  userId: string,
  reason?: string,
) {
  const where = ledgerReasonWhere(userId, reason);
  const rows = await db
    .select({ total: count() })
    .from(creditLedger)
    .where(where);
  return Number(rows[0]?.total ?? 0);
}

export async function ordersPage(
  db: Database,
  userId: string,
  limit: number,
  offset: number,
  status?: string,
) {
  if (limit < 1) return [];
  const where = orderStatusWhere(userId, status);
  return db
    .select()
    .from(creditOrders)
    .where(where)
    .orderBy(desc(creditOrders.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function ordersCount(
  db: Database,
  userId: string,
  status?: string,
) {
  const where = orderStatusWhere(userId, status);
  const rows = await db
    .select({ total: count() })
    .from(creditOrders)
    .where(where);
  return Number(rows[0]?.total ?? 0);
}

export async function pendingOrdersFor(db: Database, userId: string) {
  return db
    .select()
    .from(creditOrders)
    .where(
      and(eq(creditOrders.userId, userId), eq(creditOrders.status, 'pending')),
    )
    .orderBy(desc(creditOrders.createdAt));
}

/** @deprecated Gunakan {@link ordersPage} dengan limit/offset. */
export async function ordersFor(db: Database, userId: string) {
  return ordersPage(db, userId, 20, 0);
}

export async function activePacks(db: Database) {
  return db
    .select()
    .from(creditPacks)
    .where(eq(creditPacks.active, 1))
    .orderBy(creditPacks.sort);
}

export { balanceOf };
