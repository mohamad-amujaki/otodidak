import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { UserRow } from '../src/db/schema';
import { database } from '../src/server/account';
import { adminAdjustLedger } from '../src/server/admin-mutations';
import {
  createCreditCode,
  formatRedeemCode,
  listCreditCodes,
  normalizeRedeemCode,
  redeemCreditCode,
  setCreditCodeActive,
} from '../src/server/credit-codes';
import { signIn } from './helpers';

async function adminActor(email: string): Promise<UserRow> {
  const row = await env.DB.prepare('select * from user where email = ?')
    .bind(email)
    .first<UserRow>();
  if (!row) throw new Error('admin tidak ada');
  return row;
}

async function userIdOf(email: string): Promise<string> {
  const row = await env.DB.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (!row) throw new Error(`pengguna ${email} tidak ada`);
  return row.id;
}

async function balanceOf(userId: string): Promise<number> {
  const row = await env.DB.prepare(
    'select coalesce(sum(amount), 0) as balance from credit_ledger where user_id = ?',
  )
    .bind(userId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

async function setDailyCap(cap: number): Promise<void> {
  await env.DB.prepare('update app_config set admin_daily_credit_cap = ?')
    .bind(cap)
    .run();
}

describe('kode akses kredit', () => {
  it('menormalkan dan memformat kode', () => {
    expect(normalizeRedeemCode(' abcd-efgh-ijkl ')).toBe('ABCDEFGHIJKL');
    expect(formatRedeemCode('ABCDEFGHIJKL')).toBe('ABCD-EFGH-IJKL');
  });

  it('menukar kode sekali per akun dan menghormati kuota', async () => {
    const db = await database(env);
    await signIn('admin@example.com', 'Admin');
    const actor = await adminActor('admin@example.com');
    const created = await createCreditCode(db, env, actor, {
      credits: 40,
      maxRedemptions: 2,
      expiresInDays: 30,
    });
    expect(created.formatted).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    await signIn('kode-a@example.com', 'Kode A');
    await signIn('kode-b@example.com', 'Kode B');
    await signIn('kode-c@example.com', 'Kode C');
    const userA = await userIdOf('kode-a@example.com');
    const userB = await userIdOf('kode-b@example.com');
    const userC = await userIdOf('kode-c@example.com');
    const beforeA = await balanceOf(userA);

    expect((await redeemCreditCode(db, userA, created.formatted)).status).toBe(
      'redeemed',
    );
    expect(await balanceOf(userA)).toBe(beforeA + 40);
    expect((await redeemCreditCode(db, userA, created.formatted)).status).toBe(
      'duplicate',
    );
    expect(await balanceOf(userA)).toBe(beforeA + 40);

    expect((await redeemCreditCode(db, userB, created.code)).status).toBe(
      'redeemed',
    );
    expect((await redeemCreditCode(db, userC, created.code)).status).toBe(
      'exhausted',
    );

    const rows = await env.DB.prepare(
      "select count(*) as total from credit_ledger where reason = 'redeem'",
    ).first<{ total: number }>();
    expect(Number(rows?.total ?? 0)).toBe(2);

    const list = await listCreditCodes(db);
    expect(list[0]).toMatchObject({
      id: created.id,
      redeemedCount: 2,
      maxRedemptions: 2,
    });
  });

  it('menolak kode tak dikenal, nonaktif, dan kedaluwarsa', async () => {
    const db = await database(env);
    await signIn('admin@example.com', 'Admin');
    const actor = await adminActor('admin@example.com');
    await signIn('kode-d@example.com', 'Kode D');
    const user = await userIdOf('kode-d@example.com');
    const before = await balanceOf(user);

    expect((await redeemCreditCode(db, user, 'TIDAK-ADA')).status).toBe(
      'invalid',
    );

    const off = await createCreditCode(db, env, actor, {
      credits: 10,
      maxRedemptions: 1,
      expiresInDays: 0,
    });
    await setCreditCodeActive(db, env, actor, off.id, false);
    expect((await redeemCreditCode(db, user, off.code)).status).toBe('invalid');

    const stale = await createCreditCode(db, env, actor, {
      credits: 10,
      maxRedemptions: 1,
      expiresInDays: 1,
    });
    await env.DB.prepare(
      "update credit_redeem_code set expires_at = '2020-01-01T00:00:00.000Z' where id = ?",
    )
      .bind(stale.id)
      .run();
    expect((await redeemCreditCode(db, user, stale.code)).status).toBe(
      'expired',
    );
    expect(await balanceOf(user)).toBe(before);
  });
});

describe('kategori dan batas harian admin', () => {
  it('menyimpan kategori pada baris buku besar', async () => {
    const db = await database(env);
    await signIn('admin@example.com', 'Admin');
    const actor = await adminActor('admin@example.com');
    await signIn('kategori@example.com', 'Kategori');
    const userId = await userIdOf('kategori@example.com');

    const outcome = await adminAdjustLedger(db, env, actor, userId, {
      amount: 12,
      note: 'bonus uji',
      category: 'bonus',
      nonce: 'nonce-kategori-1',
    });
    expect(outcome.status).toBe('applied');
    const row = await env.DB.prepare(
      "select category, note from credit_ledger where user_id = ? and reason = 'admin_adjust'",
    )
      .bind(userId)
      .first<{ category: string; note: string }>();
    expect(row?.category).toBe('bonus');
    expect(row?.note).toBe('bonus uji');
  });

  it('menolak penambahan yang melewati batas harian', async () => {
    const db = await database(env);
    await signIn('admin@example.com', 'Admin');
    const actor = await adminActor('admin@example.com');
    await signIn('cap@example.com', 'Cap');
    const userId = await userIdOf('cap@example.com');
    const before = await balanceOf(userId);
    await setDailyCap(20);

    const first = await adminAdjustLedger(db, env, actor, userId, {
      amount: 20,
      note: 'habiskan jatah',
      category: 'uji',
      nonce: 'nonce-cap-1',
    });
    expect(first.status).toBe('applied');

    const second = await adminAdjustLedger(db, env, actor, userId, {
      amount: 5,
      note: 'kelebihan',
      category: 'uji',
      nonce: 'nonce-cap-2',
    });
    expect(second.status).toBe('capped');
    expect(second.remaining).toBe(0);

    const negative = await adminAdjustLedger(db, env, actor, userId, {
      amount: -5,
      note: 'pengurangan tetap boleh',
      category: 'koreksi',
      nonce: 'nonce-cap-3',
    });
    expect(negative.status).toBe('applied');
    expect(await balanceOf(userId)).toBe(before + 15);
  });
});
