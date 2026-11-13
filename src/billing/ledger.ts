import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { creditLedger } from '../db/schema';
import { nowIso } from '../domain/time';

export type LedgerReason =
  | 'signup_grant'
  | 'purchase'
  | 'roadmap'
  | 'lesson'
  | 'quiz'
  | 'refund'
  | 'admin_adjust';

export async function balanceOf(db: Database, userId: string): Promise<number> {
  const row = await db.get<{ balance: number | null }>(sql`
    select coalesce(sum(amount), 0) as balance from credit_ledger where user_id = ${userId}
  `);
  return Number(row?.balance ?? 0);
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
  },
): Promise<'inserted' | 'duplicate' | 'insufficient'> {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  try {
    const result = await db.run(sql`
      insert into credit_ledger (id, user_id, amount, reason, ref_type, ref_id, idempotency_key, note, created_at)
      select ${id}, ${input.userId}, ${input.amount}, ${input.reason}, ${input.refType}, ${input.refId}, ${input.idempotencyKey}, ${input.note ?? null}, ${createdAt}
      where (select coalesce(sum(amount), 0) from credit_ledger where user_id = ${input.userId}) + ${input.amount} >= 0
        and not exists (select 1 from credit_ledger where idempotency_key = ${input.idempotencyKey})
    `);
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
  },
): Promise<boolean> {
  const inserted = await db
    .insert(creditLedger)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      amount: input.amount,
      reason: input.reason,
      refType: input.refType,
      refId: input.refId,
      idempotencyKey: input.idempotencyKey,
      note: input.note ?? null,
      createdAt: nowIso(),
    })
    .onConflictDoNothing()
    .returning({ id: creditLedger.id });
  return inserted.length > 0;
}

export async function findLedgerByKey(db: Database, key: string) {
  const rows = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, key))
    .limit(1);
  return rows[0] ?? null;
}
