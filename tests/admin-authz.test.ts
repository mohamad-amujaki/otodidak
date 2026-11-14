import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { balanceOf, debitIfEnough } from '../src/billing/ledger';
import { database } from '../src/server/account';
import { refundJob } from '../src/server/generation';
import { api, jsonBody, signIn } from './helpers';

const superadminEmail = 'admin@example.com';

beforeEach(async () => {
  await database(env);
});

async function userIdOf(email: string): Promise<string> {
  const row = await env.DB.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (!row) throw new Error(`pengguna ${email} tidak ada`);
  return row.id;
}

async function auditCount(action: string): Promise<number> {
  const row = await env.DB.prepare(
    'select count(*) as n from admin_audit where action = ?',
  )
    .bind(action)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function promote(actorCookie: string, email: string): Promise<string> {
  await signIn(email, 'Admin Kedua');
  const id = await userIdOf(email);
  const response = await api(`/api/admin/users/${id}`, {
    method: 'PATCH',
    json: { role: 'admin' },
    cookie: actorCookie,
  });
  expect(response.status).toBe(200);
  return id;
}

describe('batas peran dan status admin', () => {
  it('admin biasa tidak bisa menahan atau menurunkan superadmin', async () => {
    const superadmin = await signIn(superadminEmail, 'Superadmin');
    await promote(superadmin, 'rekan@example.com');
    const peer = await signIn('rekan@example.com', 'Rekan');
    const superadminId = await userIdOf(superadminEmail);

    const suspend = await api(`/api/admin/users/${superadminId}`, {
      method: 'PATCH',
      json: { status: 'suspended' },
      cookie: peer,
    });
    expect(suspend.status).toBe(403);

    const demote = await api(`/api/admin/users/${superadminId}`, {
      method: 'PATCH',
      json: { role: 'learner' },
      cookie: peer,
    });
    expect(demote.status).toBe(403);

    const row = await env.DB.prepare(
      'select role, status from user where id = ?',
    )
      .bind(superadminId)
      .first<{ role: string; status: string }>();
    expect(row).toMatchObject({ role: 'admin', status: 'active' });
  });

  it('admin biasa tetap bisa menahan pelajar dan aksinya tercatat', async () => {
    const superadmin = await signIn(superadminEmail, 'Superadmin');
    await promote(superadmin, 'rekan2@example.com');
    const peer = await signIn('rekan2@example.com', 'Rekan Dua');
    await signIn('pelajar-status@example.com', 'Pelajar');
    const learnerId = await userIdOf('pelajar-status@example.com');
    const before = await auditCount('user_update');

    const response = await api(`/api/admin/users/${learnerId}`, {
      method: 'PATCH',
      json: { status: 'suspended' },
      cookie: peer,
    });
    expect(response.status).toBe(200);
    expect(await auditCount('user_update')).toBe(before + 1);
  });

  it('superadmin tidak bisa menurunkan dirinya sendiri', async () => {
    const superadmin = await signIn(superadminEmail, 'Superadmin');
    const id = await userIdOf(superadminEmail);
    const response = await api(`/api/admin/users/${id}`, {
      method: 'PATCH',
      json: { role: 'learner' },
      cookie: superadmin,
    });
    expect(response.status).toBe(400);
  });
});

describe('hapus materi belajar', () => {
  it('admin biasa boleh menghapus pelajar dan aksinya tercatat', async () => {
    const superadmin = await signIn(superadminEmail, 'Superadmin');
    await promote(superadmin, 'rekan3@example.com');
    const peer = await signIn('rekan3@example.com', 'Rekan Tiga');
    const learner = await signIn('korban@example.com', 'Korban');
    const started = await api('/api/paths', {
      method: 'POST',
      json: { topic: 'Merawat tanaman kopi' },
      cookie: learner,
    });
    expect(started.status).toBe(202);
    const learnerId = await userIdOf('korban@example.com');
    const before = await auditCount('learning_erase');

    const response = await api(`/api/admin/users/${learnerId}/deletion`, {
      method: 'POST',
      json: {},
      cookie: peer,
    });
    expect(response.status).toBe(200);
    expect(await auditCount('learning_erase')).toBe(before + 1);
    const paths = await env.DB.prepare(
      'select count(*) as n from path where user_id = ?',
    )
      .bind(learnerId)
      .first<{ n: number }>();
    expect(Number(paths?.n ?? 0)).toBe(0);
  });

  it('admin biasa tidak bisa menghapus materi superadmin', async () => {
    const superadmin = await signIn(superadminEmail, 'Superadmin');
    await promote(superadmin, 'rekan4@example.com');
    const peer = await signIn('rekan4@example.com', 'Rekan Empat');
    const superadminId = await userIdOf(superadminEmail);

    const response = await api(`/api/admin/users/${superadminId}/deletion`, {
      method: 'POST',
      json: {},
      cookie: peer,
    });
    expect(response.status).toBe(403);
    const still = await env.DB.prepare('select id from user where id = ?')
      .bind(superadminId)
      .first<{ id: string }>();
    expect(still?.id).toBe(superadminId);
  });
});

describe('riwayat tindakan admin', () => {
  it('detail pengguna memuat audit tindakan terbaru', async () => {
    const superadmin = await signIn(superadminEmail, 'Superadmin');
    await signIn('audit-target@example.com', 'Audit Target');
    const targetId = await userIdOf('audit-target@example.com');
    await api(`/api/admin/users/${targetId}`, {
      method: 'PATCH',
      json: { status: 'suspended' },
      cookie: superadmin,
    });
    const detail = await api(`/api/admin/users/${targetId}`, {
      cookie: superadmin,
    });
    expect(detail.status).toBe(200);
    const body = await jsonBody<{ audit: { action: string }[] }>(detail);
    expect(body.audit.some((row) => row.action === 'user_update')).toBe(true);
  });
});

describe('pengembalian kredit per debit', () => {
  it('mengembalikan setiap debit job dan tetap idempoten', async () => {
    await signIn('ulang-kredit@example.com');
    const userId = await userIdOf('ulang-kredit@example.com');
    const db = await database(env);
    const before = await balanceOf(db, userId);
    const jobId = crypto.randomUUID();
    const lessonId = crypto.randomUUID();
    const job = { id: jobId, userId, kind: 'lesson' as const, refId: lessonId };

    await debitIfEnough(db, {
      userId,
      amount: -3,
      reason: 'lesson',
      refType: 'job',
      refId: jobId,
      idempotencyKey: `lesson:${lessonId}`,
    });
    await refundJob(env, db, job);
    await refundJob(env, db, job);
    expect(await refundCount(jobId)).toBe(1);
    expect(await balanceOf(db, userId)).toBe(before);

    await debitIfEnough(db, {
      userId,
      amount: -3,
      reason: 'lesson',
      refType: 'job',
      refId: jobId,
      idempotencyKey: `admin-requeue:${jobId}:1`,
    });
    await refundJob(env, db, job);
    expect(await refundCount(jobId)).toBe(2);
    expect(await balanceOf(db, userId)).toBe(before);
  });
});

async function refundCount(jobId: string): Promise<number> {
  const row = await env.DB.prepare(
    "select count(*) as n from credit_ledger where ref_id = ? and reason = 'refund'",
  )
    .bind(jobId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}
