import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { debitIfEnough } from '../src/billing/ledger';
import { generationJobs } from '../src/db/schema';
import { database } from '../src/server/account';
import {
  handleQueue,
  processGeneration,
  sweepStaleJobs,
} from '../src/server/generation';
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

  it('tidak memblokir pelajaran baru karena job basi', async () => {
    const cookie = await signIn('terblokir@example.com');
    const started = await api('/api/paths', {
      method: 'POST',
      json: { topic: 'Menulis ringkasan eksekutif' },
      cookie,
    });
    expect(started.status).toBe(202);
    const path = await jsonBody<{ jobId: string; pathId: string }>(started);
    expect(await processGeneration(env, path.jobId, 1)).toBe('ack');
    const detail = await jsonBody<{
      chapters: { lessons: { id: string }[] }[];
    }>(await api(`/api/paths/${path.pathId}`, { cookie }));
    const lessonId = detail.chapters[0]?.lessons[0]?.id;
    if (!lessonId) throw new Error('pelajaran tidak ada');

    // Job lama yang pesan antreannya hilang: status queued, tidak pernah jalan.
    const userId = await userIdFor('terblokir@example.com');
    const db = await database(env);
    const staleId = crypto.randomUUID();
    await db.insert(generationJobs).values({
      id: staleId,
      userId,
      kind: 'lesson',
      refId: crypto.randomUUID(),
      status: 'queued',
      attempts: 0,
      createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });

    const opened = await api(`/api/lessons/${lessonId}/open`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(opened.status).toBe(202);
    const created = await jsonBody<{ jobId: string }>(opened);
    expect(created.jobId).not.toBe(staleId);

    const stale = await env.DB.prepare(
      'select status, error_code from generation_job where id = ?',
    )
      .bind(staleId)
      .first<{ status: string; error_code: string | null }>();
    expect(stale?.status).toBe('failed');
    expect(stale?.error_code).toBe('queue_stale');
  });

  it('mengulang pesan antrean bila job belum terbaca', async () => {
    let retried = 0;
    await handleQueue(
      {
        queue: 'generation',
        messages: [
          {
            body: { jobId: crypto.randomUUID() },
            attempts: 1,
            ack() {},
            retry() {
              retried += 1;
            },
          },
        ],
      } as unknown as MessageBatch<{ jobId: string }>,
      env,
    );
    expect(retried).toBe(1);
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
