import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { debitIfEnough } from '../src/billing/ledger';
import { generationJobs } from '../src/db/schema';
import { database } from '../src/server/account';
import { sweepStaleJobs } from '../src/server/generation';
import { api, jsonBody, signIn } from './helpers';

beforeEach(async () => {
  await database(env);
});

async function userIdFor(email: string): Promise<string> {
  const row = await env.DB.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (!row) throw new Error('pengguna tidak ada');
  return row.id;
}

describe('sweeper job basi', () => {
  it('mengembalikan kredit job queued yang tidak pernah diproses', async () => {
    const cookie = await signIn('basi@example.com');
    const userId = await userIdFor('basi@example.com');
    const before = await api('/api/me', { cookie });
    const startingBalance = (await jsonBody<{ balance: number }>(before))
      .balance;
    const db = await database(env);
    const jobId = crypto.randomUUID();
    const lessonId = crypto.randomUUID();
    await debitIfEnough(db, {
      userId,
      amount: -3,
      reason: 'lesson',
      refType: 'job',
      refId: jobId,
      idempotencyKey: `lesson:${lessonId}`,
    });
    await db.insert(generationJobs).values({
      id: jobId,
      userId,
      kind: 'lesson',
      refId: lessonId,
      status: 'queued',
      attempts: 0,
      createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });

    await sweepStaleJobs(env);

    const row = await env.DB.prepare(
      'select status, error_code, refunded_at from generation_job where id = ?',
    )
      .bind(jobId)
      .first<{
        status: string;
        error_code: string | null;
        refunded_at: string | null;
      }>();
    expect(row?.status).toBe('failed');
    expect(row?.error_code).toBe('queue_stale');
    expect(row?.refunded_at).toBeTruthy();

    const refund = await env.DB.prepare(
      "select count(*) as n from credit_ledger where ref_id = ? and reason = 'refund'",
    )
      .bind(jobId)
      .first<{ n: number }>();
    expect(Number(refund?.n ?? 0)).toBe(1);

    const me = await api('/api/me', { cookie });
    const body = await jsonBody<{ balance: number }>(me);
    expect(body.balance).toBe(startingBalance);
  });

  it('membiarkan job queued yang masih baru', async () => {
    await signIn('baru@example.com');
    const userId = await userIdFor('baru@example.com');
    const db = await database(env);
    const jobId = crypto.randomUUID();
    await db.insert(generationJobs).values({
      id: jobId,
      userId,
      kind: 'lesson',
      refId: crypto.randomUUID(),
      status: 'queued',
      attempts: 0,
      createdAt: new Date().toISOString(),
    });

    await sweepStaleJobs(env);

    const row = await env.DB.prepare(
      'select status from generation_job where id = ?',
    )
      .bind(jobId)
      .first<{ status: string }>();
    expect(row?.status).toBe('queued');
  });
});
