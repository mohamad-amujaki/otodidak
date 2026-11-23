import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { creditLedger, users } from '../db/schema';
import { nowIso } from '../domain/time';

export type LedgerReason =
  | 'signup_grant'
  | 'purchase'
  | 'roadmap'
  | 'lesson'
  | 'quiz'
  | 'outline'
  | 'refund'
  | 'admin_adjust'
  | 'redeem';

export async function balanceOf(db: Database, userId: string): Promise<number> {
  const row = await db.get<{ balance: number | null }>(sql`
    select balance from user where id = ${userId}
  `);
  return Number(row?.balance ?? 0);
}

/** Saldo mengikuti ledger di transaksi yang sama, supaya baca halaman tidak menjumlah ulang. */
export function syncStoredBalance(db: Database, userId: string) {
  return db
    .update(users)
    .set({
      balance: sql`(select coalesce(sum(${creditLedger.amount}), 0) from ${creditLedger} where ${creditLedger.userId} = ${userId})`,
    })
    .where(eq(users.id, userId));
}

export async function debitIfEnough(
  db: Database,
  input: {
    userId: string;
    amount: number;
    reason: LedgerReason;
    refType: string | null;
    refId: string | null;
    idempotencyKey: string;
    note?: string | null;
    category?: string | null;
  },
): Promise<'inserted' | 'duplicate' | 'insufficient'> {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  try {
    const [result] = await db.$client.batch([
      db.$client
        .prepare(
          `insert into credit_ledger (id, user_id, amount, reason, ref_type, ref_id, idempotency_key, note, category, created_at)
           select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
           where (select balance from user where id = ?2) + ?3 >= 0
             and not exists (select 1 from credit_ledger where idempotency_key = ?7)`,
        )
        .bind(
          id,
          input.userId,
          input.amount,
          input.reason,
          input.refType,
          input.refId,
          input.idempotencyKey,
          input.note ?? null,
          input.category ?? null,
          createdAt,
        ),
      db.$client
        .prepare(
          `update user set balance = (
             select coalesce(sum(amount), 0) from credit_ledger where user_id = ?1
           ) where id = ?1`,
        )
        .bind(input.userId),
    ]);
    if ((result.meta?.changes ?? 0) > 0) return 'inserted';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('UNIQUE')) throw error;
  }
  const existing = await db.get<{ id: string }>(sql`
    select id from credit_ledger where idempotency_key = ${input.idempotencyKey} limit 1
  `);
  return existing ? 'duplicate' : 'insufficient';
}

export async function insertLedger(
  db: Database,
  input: {
    userId: string;
    amount: number;
    reason: LedgerReason;
    refType: string | null;
    refId: string | null;
    idempotencyKey: string;
    note?: string | null;
    category?: string | null;
  },
): Promise<boolean> {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .insert(creditLedger)
      .values({
        id,
        userId: input.userId,
        amount: input.amount,
        reason: input.reason,
        refType: input.refType,
        refId: input.refId,
        idempotencyKey: input.idempotencyKey,
        note: input.note ?? null,
        category: input.category ?? null,
        createdAt: nowIso(),
      })
      .onConflictDoNothing(),
    syncStoredBalance(db, input.userId),
  ]);
  const inserted = await db.get<{ id: string }>(sql`
    select id from credit_ledger where id = ${id} limit 1
  `);
  return Boolean(inserted);
}

export async function findLedgerByKey(db: Database, key: string) {
  const rows = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, key))
    .limit(1);
  return rows[0] ?? null;
}
