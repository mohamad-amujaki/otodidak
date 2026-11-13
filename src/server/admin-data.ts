import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { balanceOf, balancesByUserIds } from '../billing/ledger';
import type { Database } from '../db/client';
import {
  aiModels,
  aiProviders,
  creditLedger,
  creditOrders,
  creditPacks,
  generationJobs,
  promptTemplates,
  users,
} from '../db/schema';
import { AppError } from '../domain/errors';
import type { TaskName } from '../domain/schemas';
import { activePacks, ledgerPage, loadConfig, ordersFor } from './account';
import {
  adminJobsTotal,
  adminLedgerTotal,
  adminOrdersTotal,
  adminUsersTotal,
  jobFiltersWhere,
  orderFiltersWhere,
  readAdminQuery,
  userFiltersWhere,
} from './admin-list';

export async function fetchAdminStats(db: Database) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row = await db.get<{
    users: number | null;
    newUsers: number | null;
    deletionRequests: number | null;
    pendingOrders: number | null;
    jobsQueued: number | null;
    jobsFailed: number | null;
  }>(sql`
      select
        (select count(*) from user) as users,
        (select count(*) from user where created_at >= ${weekAgo}) as newUsers,
        (select count(*) from user where deletion_requested_at is not null) as deletionRequests,
        (select count(*) from credit_order where status = 'pending') as pendingOrders,
        (select count(*) from generation_job where status in ('queued', 'running')) as jobsQueued,
        (select count(*) from generation_job where status = 'failed') as jobsFailed
    `);
  return {
    users: Number(row?.users ?? 0),
    newUsers: Number(row?.newUsers ?? 0),
    deletionRequests: Number(row?.deletionRequests ?? 0),
    pendingOrders: Number(row?.pendingOrders ?? 0),
    jobsQueued: Number(row?.jobsQueued ?? 0),
    jobsFailed: Number(row?.jobsFailed ?? 0),
  };
}

export async function listAdminUsers(db: Database, url: string) {
  const query = readAdminQuery(url);
  const filters = userFiltersWhere(query);
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(users)
      .where(filters)
      .orderBy(desc(users.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    adminUsersTotal(db, query),
  ]);
  const balances = await balancesByUserIds(
    db,
    rows.map((user) => user.id),
  );
  const list = rows.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    balance: balances.get(user.id) ?? 0,
    deletionRequestedAt: user.deletionRequestedAt,
  }));
  return { users: list, total };
}

export async function adminUserDetail(db: Database, userId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) throw new AppError('not_found');
  const pathCount = await db.get<{ n: number | null }>(sql`
      select count(*) as n from path where user_id = ${userId}
    `);
  const entries = await ledgerPage(db, userId, 15, 0);
  const orders = await ordersFor(db, userId);
  const job = await db
    .select()
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
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      balance: await balanceOf(db, user.id),
      deletionRequestedAt: user.deletionRequestedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    pathCount: Number(pathCount?.n ?? 0),
    ledger: entries,
    orders,
    activeJob: job[0] ?? null,
  };
}

export async function listAdminJobs(db: Database, url: string) {
  const query = readAdminQuery(url);
  const where = jobFiltersWhere(query);
  const [jobs, total] = await Promise.all([
    db
      .select({
        id: generationJobs.id,
        userId: generationJobs.userId,
        kind: generationJobs.kind,
        refId: generationJobs.refId,
        status: generationJobs.status,
        errorCode: generationJobs.errorCode,
        attempts: generationJobs.attempts,
        createdAt: generationJobs.createdAt,
        finishedAt: generationJobs.finishedAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(generationJobs)
      .innerJoin(users, eq(generationJobs.userId, users.id))
      .where(where)
      .orderBy(desc(generationJobs.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    adminJobsTotal(db, query),
  ]);
  return { jobs, total };
}

export async function listAdminLedger(db: Database, url: string) {
  const query = readAdminQuery(url);
  const filters = query.userId
    ? eq(creditLedger.userId, query.userId)
    : undefined;
  const [entries, total] = await Promise.all([
    db
      .select({
        id: creditLedger.id,
        userId: creditLedger.userId,
        amount: creditLedger.amount,
        reason: creditLedger.reason,
        note: creditLedger.note,
        createdAt: creditLedger.createdAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(creditLedger)
      .innerJoin(users, eq(creditLedger.userId, users.id))
      .where(filters)
      .orderBy(desc(creditLedger.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    adminLedgerTotal(db, query),
  ]);
  return { entries, total };
}

export async function listAdminOrders(db: Database, url: string) {
  const query = readAdminQuery(url);
  const where = orderFiltersWhere(query);
  const [orders, total] = await Promise.all([
    db
      .select({
        id: creditOrders.id,
        userId: creditOrders.userId,
        packId: creditOrders.packId,
        orderId: creditOrders.orderId,
        amountIdr: creditOrders.amountIdr,
        credits: creditOrders.credits,
        status: creditOrders.status,
        createdAt: creditOrders.createdAt,
        paidAt: creditOrders.paidAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(creditOrders)
      .innerJoin(users, eq(creditOrders.userId, users.id))
      .where(where)
      .orderBy(desc(creditOrders.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    adminOrdersTotal(db, query),
  ]);
  return { orders, total };
}

export async function listAllPacks(db: Database) {
  return db.select().from(creditPacks).orderBy(asc(creditPacks.sort));
}

export async function publicCreditPacks(db: Database) {
  return activePacks(db);
}

export async function getPromptForTask(db: Database, task: TaskName) {
  const rows = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.task, task))
    .limit(1);
  if (!rows[0]) throw new AppError('not_found');
  return rows[0];
}

export async function getActiveModelForTask(db: Database, task: TaskName) {
  const rows = await db
    .select({
      modelName: aiModels.modelName,
      maxOutputTokens: aiModels.maxOutputTokens,
      timeoutMs: aiModels.timeoutMs,
      baseUrl: aiProviders.baseUrl,
      secretName: aiProviders.secretName,
      authKind: aiProviders.authKind,
    })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
    .where(and(eq(aiModels.task, task), eq(aiModels.active, 1)))
    .limit(1);
  if (!rows[0]) throw new AppError('not_found');
  return rows[0];
}

export { loadConfig };
