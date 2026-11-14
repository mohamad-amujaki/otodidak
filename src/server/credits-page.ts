import type { z } from 'zod';
import { balanceOf } from '../billing/ledger';
import type { Database } from '../db/client';
import type { UserRow } from '../db/schema';
import { AppError } from '../domain/errors';
import { creditsQuerySchema } from '../domain/schemas';
import {
  ledgerCount,
  ledgerPage,
  ordersCount,
  ordersPage,
  pendingOrdersFor,
} from './account';
import { enrichLedgerEntries, ledgerSummary30d } from './ledger-enrich';

export type CreditsQuery = z.infer<typeof creditsQuerySchema>;

export function readCreditsQuery(url: string): CreditsQuery {
  const parsed = creditsQuerySchema.safeParse(
    Object.fromEntries(new URL(url).searchParams),
  );
  if (!parsed.success) throw new AppError('validation');
  return parsed.data;
}

export async function creditsPayload(db: Database, user: UserRow, url: string) {
  const query = readCreditsQuery(url);
  const reason = query.reason || undefined;
  const status = query.status || undefined;
  const rawEntries = await ledgerPage(
    db,
    user.id,
    query.limit,
    query.offset,
    reason,
  );
  const [
    balance,
    entries,
    entriesTotal,
    orders,
    ordersTotal,
    pendingOrders,
    summary30d,
  ] = await Promise.all([
    balanceOf(db, user.id),
    query.limit > 0
      ? enrichLedgerEntries(db, user.id, rawEntries)
      : Promise.resolve([]),
    ledgerCount(db, user.id, reason),
    ordersPage(db, user.id, query.ordersLimit, query.ordersOffset, status),
    ordersCount(db, user.id, status),
    query.includePending ? pendingOrdersFor(db, user.id) : Promise.resolve([]),
    ledgerSummary30d(db, user.id),
  ]);
  return {
    balance,
    entries,
    entriesTotal,
    orders,
    ordersTotal,
    pendingOrders,
    pendingOrdersTotal: pendingOrders.length,
    summary30d,
  };
}
