import { and, count, eq, isNotNull, like, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../db/client';
import {
  creditLedger,
  creditOrders,
  generationJobs,
  users,
} from '../db/schema';
import { AppError } from '../domain/errors';
import { adminPageSchema } from '../domain/schemas';

export type AdminListQuery = z.infer<typeof adminPageSchema>;

export function readAdminQuery(url: string): AdminListQuery {
  const parsed = adminPageSchema.safeParse(
    Object.fromEntries(new URL(url).searchParams),
  );
  if (!parsed.success) throw new AppError('validation');
  return parsed.data;
}

function userFilters(query: AdminListQuery): SQL | undefined {
  const parts: SQL[] = [];
  if (query.email) parts.push(eq(users.email, query.email));
  else if (query.q) {
    const needle = `%${query.q.replace(/%/g, '')}%`;
    const match = or(like(users.email, needle), like(users.name, needle));
    if (match) parts.push(match);
  }
  if (query.role) parts.push(eq(users.role, query.role));
  if (query.status) parts.push(eq(users.status, query.status));
  if (query.deletion) parts.push(isNotNull(users.deletionRequestedAt));
  return parts.length > 0 ? and(...parts) : undefined;
}

export async function adminUsersTotal(db: Database, query: AdminListQuery) {
  const where = userFilters(query);
  const rows = await db.select({ total: count() }).from(users).where(where);
  return Number(rows[0]?.total ?? 0);
}

export function userFiltersWhere(query: AdminListQuery) {
  return userFilters(query);
}

export async function adminLedgerTotal(db: Database, query: AdminListQuery) {
  const filters = query.userId
    ? eq(creditLedger.userId, query.userId)
    : undefined;
  const rows = await db
    .select({ total: count() })
    .from(creditLedger)
    .where(filters);
  return Number(rows[0]?.total ?? 0);
}

export async function adminOrdersTotal(db: Database, query: AdminListQuery) {
  const where = orderFiltersWhere(query);
  const rows = await db
    .select({ total: count() })
    .from(creditOrders)
    .where(where);
  return Number(rows[0]?.total ?? 0);
}

export function orderFiltersWhere(query: AdminListQuery): SQL | undefined {
  const parts: SQL[] = [];
  if (query.userId) parts.push(eq(creditOrders.userId, query.userId));
  if (query.orderStatus) {
    parts.push(
      eq(
        creditOrders.status,
        query.orderStatus as (typeof creditOrders.$inferSelect)['status'],
      ),
    );
  }
  return parts.length > 0 ? and(...parts) : undefined;
}

export async function adminJobsTotal(db: Database, query: AdminListQuery) {
  const where = jobFiltersWhere(query);
  const rows = await db
    .select({ total: count() })
    .from(generationJobs)
    .where(where);
  return Number(rows[0]?.total ?? 0);
}

export function jobFiltersWhere(query: AdminListQuery): SQL | undefined {
  const parts: SQL[] = [];
  if (query.jobStatus) {
    parts.push(
      eq(
        generationJobs.status,
        query.jobStatus as (typeof generationJobs.$inferSelect)['status'],
      ),
    );
  }
  if (query.jobKind) {
    parts.push(
      eq(
        generationJobs.kind,
        query.jobKind as (typeof generationJobs.$inferSelect)['kind'],
      ),
    );
  }
  return parts.length > 0 ? and(...parts) : undefined;
}
