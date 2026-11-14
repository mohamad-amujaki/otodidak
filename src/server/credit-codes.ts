import { and, desc, eq, sql } from 'drizzle-orm';
import { insertLedger } from '../billing/ledger';
import type { Database } from '../db/client';
import {
  creditRedeemCodes,
  creditRedeemRedemptions,
  type UserRow,
} from '../db/schema';
import { AppError } from '../domain/errors';
import { nowIso } from '../domain/time';
import { assertSuperadmin } from './admin-access';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

export function normalizeRedeemCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function formatRedeemCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

export function generateRedeemCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(
    bytes,
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? 'A',
  ).join('');
}

export interface CreditCodeInput {
  credits: number;
  maxRedemptions: number;
  expiresInDays: number;
}

export interface CreditCodeRow {
  id: string;
  code: string;
  credits: number;
  maxRedemptions: number;
  redeemedCount: number;
  active: number;
  expiresAt: string | null;
  createdAt: string;
}

export async function createCreditCode(
  db: Database,
  env: Env,
  actor: UserRow,
  input: CreditCodeInput,
): Promise<{ id: string; code: string; formatted: string }> {
  assertSuperadmin(env, actor);
  const credits = Math.trunc(input.credits);
  const maxRedemptions = Math.trunc(input.maxRedemptions);
  const days = Math.trunc(input.expiresInDays);
  if (!Number.isFinite(credits) || credits < 1 || credits > 100_000)
    throw new AppError('validation', 'Kredit kode harus 1–100000.');
  if (
    !Number.isFinite(maxRedemptions) ||
    maxRedemptions < 1 ||
    maxRedemptions > 500
  )
    throw new AppError('validation', 'Kuota pemakaian harus 1–500.');
  if (!Number.isFinite(days) || days < 0 || days > 365)
    throw new AppError('validation', 'Masa berlaku harus 0–365 hari.');
  const expiresAt =
    days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID();
    const code = generateRedeemCode();
    try {
      await db.insert(creditRedeemCodes).values({
        id,
        code,
        credits,
        maxRedemptions,
        redeemedCount: 0,
        active: 1,
        expiresAt,
        createdAt: nowIso(),
        createdBy: actor.id,
      });
      return { id, code, formatted: formatRedeemCode(code) };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('UNIQUE')) throw error;
    }
  }
  throw new AppError('rate_limited');
}

export async function setCreditCodeActive(
  db: Database,
  env: Env,
  actor: UserRow,
  codeId: string,
  active: boolean,
): Promise<void> {
  assertSuperadmin(env, actor);
  await db
    .update(creditRedeemCodes)
    .set({ active: active ? 1 : 0 })
    .where(eq(creditRedeemCodes.id, codeId));
}

export async function listCreditCodes(
  db: Database,
  limit = 50,
): Promise<CreditCodeRow[]> {
  const rows = await db
    .select({
      id: creditRedeemCodes.id,
      code: creditRedeemCodes.code,
      credits: creditRedeemCodes.credits,
      maxRedemptions: creditRedeemCodes.maxRedemptions,
      redeemedCount: creditRedeemCodes.redeemedCount,
      active: creditRedeemCodes.active,
      expiresAt: creditRedeemCodes.expiresAt,
      createdAt: creditRedeemCodes.createdAt,
    })
    .from(creditRedeemCodes)
    .orderBy(desc(creditRedeemCodes.createdAt))
    .limit(limit);
  return rows;
}

export type RedeemStatus =
  | 'redeemed'
  | 'duplicate'
  | 'exhausted'
  | 'expired'
  | 'invalid';

export interface RedeemResult {
  status: RedeemStatus;
  credits: number;
}

export async function redeemCreditCode(
  db: Database,
  userId: string,
  rawCode: string,
): Promise<RedeemResult> {
  const code = normalizeRedeemCode(rawCode);
  if (code.length < CODE_LENGTH) return { status: 'invalid', credits: 0 };
  const rows = await db
    .select()
    .from(creditRedeemCodes)
    .where(eq(creditRedeemCodes.code, code))
    .limit(1);
  const found = rows[0];
  if (found?.active !== 1) return { status: 'invalid', credits: 0 };
  if (found.expiresAt && found.expiresAt <= nowIso())
    return { status: 'expired', credits: 0 };
  const already = await db
    .select({ id: creditRedeemRedemptions.id })
    .from(creditRedeemRedemptions)
    .where(
      and(
        eq(creditRedeemRedemptions.codeId, found.id),
        eq(creditRedeemRedemptions.userId, userId),
      ),
    )
    .limit(1);
  if (already.length > 0) return { status: 'duplicate', credits: 0 };
  try {
    await db.insert(creditRedeemRedemptions).values({
      id: crypto.randomUUID(),
      codeId: found.id,
      userId,
      credits: found.credits,
      createdAt: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('UNIQUE')) return { status: 'duplicate', credits: 0 };
    throw error;
  }
  const claimed = await db.run(sql`
    update credit_redeem_code
       set redeemed_count = redeemed_count + 1
     where id = ${found.id}
       and active = 1
       and redeemed_count < max_redemptions
  `);
  if ((claimed.meta?.changes ?? 0) === 0) {
    await db
      .delete(creditRedeemRedemptions)
      .where(
        and(
          eq(creditRedeemRedemptions.codeId, found.id),
          eq(creditRedeemRedemptions.userId, userId),
        ),
      );
    return { status: 'exhausted', credits: 0 };
  }
  await insertLedger(db, {
    userId,
    amount: found.credits,
    reason: 'redeem',
    refType: 'redeem_code',
    refId: found.id,
    idempotencyKey: `redeem:${found.id}:${userId}`,
    note: `Kode akses ${formatRedeemCode(found.code)}`,
  });
  return { status: 'redeemed', credits: found.credits };
}
