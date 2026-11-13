import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { debitIfEnough } from '../src/billing/ledger';
import { signSvix } from '../src/billing/webhook';
import { database } from '../src/server/account';
import { processGeneration } from '../src/server/generation';
import { api, jsonBody, signIn } from './helpers';

const webhookSecret = 'whsec_b3RvZGlkYWstdGVzdC13ZWJob29rLXNlY3JldC1rZXk=';

beforeEach(async () => {
  await database(env);
});

describe('kredit', () => {
  it('debit yang tidak cukup tidak menulis baris', async () => {
    await signIn('pelajar@example.com');
    const userId = await userIdFor('pelajar@example.com');
    const before = await count(
      'select count(*) as n from credit_ledger where user_id = ?',
      userId,
    );
    const db = await database(env);
    const result = await debitIfEnough(db, {
      userId,
      amount: -1000,
      reason: 'lesson',
      refType: 'job',
      refId: crypto.randomUUID(),
      idempotencyKey: `lesson:${crypto.randomUUID()}`,
    });
    expect(result).toBe('insufficient');
    expect(
      await count(
        'select count(*) as n from credit_ledger where user_id = ?',
        userId,
      ),
    ).toBe(before);
  });

  it('kunci lesson:{lessonId} menolak debit kedua', async () => {
    const cookie = await signIn('kunci@example.com');
    const userId = await userIdFor('kunci@example.com');
    const lessonId = crypto.randomUUID();
    const db = await database(env);
    const first = await debitIfEnough(db, {
      userId,
      amount: -3,
      reason: 'lesson',
      refType: 'job',
      refId: crypto.randomUUID(),
      idempotencyKey: `lesson:${lessonId}`,
    });
    const second = await debitIfEnough(db, {
      userId,
      amount: -3,
      reason: 'lesson',
      refType: 'job',
      refId: crypto.randomUUID(),
      idempotencyKey: `lesson:${lessonId}`,
    });
    expect(first).toBe('inserted');
    expect(second).toBe('duplicate');
    expect(
      await count(
        'select count(*) as n from credit_ledger where idempotency_key = ?',
        `lesson:${lessonId}`,
      ),
    ).toBe(1);
    expect(cookie).toContain('otodidak_dev=');
  });
});

describe('putaran belajar', () => {
  it('membaca pelajaran yang sudah siap tidak mengurangi kredit', async () => {
    const cookie = await signIn('baca@example.com');
    const lessonId = await readyLesson(cookie);
    const before = await balance(cookie);
    const opened = await api(`/api/lessons/${lessonId}/open`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(opened.status).toBe(200);
    const body = await jsonBody<{ body: string }>(opened);
    expect(body.body.length).toBeGreaterThan(0);
    expect(await balance(cookie)).toBe(before);
  });

  it('menambah pelajaran dengan AI di tinjau jalur', async () => {
    const cookie = await signIn('ai-outline@example.com');
    const started = await startPath(cookie);
    expect(await processGeneration(env, started.jobId, 1)).toBe('ack');
    const detail = await api(`/api/paths/${started.pathId}`, { cookie });
    const body = await jsonBody<{
      chapters: { id: string; lessons: { id: string }[] }[];
    }>(detail);
    const chapterId = body.chapters[0]?.id;
    if (!chapterId) throw new Error('bab tidak ada');
    const before = await balance(cookie);
    const added = await api(`/api/chapters/${chapterId}/lessons/ai`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(added.status).toBe(200);
    const lesson = await jsonBody<{ lessonId: string; title: string }>(added);
    expect(lesson.title.length).toBeGreaterThan(0);
    expect(await balance(cookie)).toBe(before - 1);
    const after = await api(`/api/paths/${started.pathId}`, { cookie });
    const again = await jsonBody<{
      chapters: { lessons: { id: string }[] }[];
    }>(after);
    expect(
      again.chapters[0]?.lessons.some((row) => row.id === lesson.lessonId),
    ).toBe(true);
  });

  it('kunci pelajaran yang sudah ada menolak pembukaan kedua', async () => {
    const cookie = await signIn('ulang@example.com');
    const started = await startPath(cookie);
    await processGeneration(env, started.jobId, 1);
    const lessonId = await firstLesson(cookie, started.pathId);
    const first = await api(`/api/lessons/${lessonId}/open`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(first.status).toBe(202);
    await env.DB.prepare("update lesson set status = 'outline' where id = ?")
      .bind(lessonId)
      .run();
    const second = await api(`/api/lessons/${lessonId}/open`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(second.status).toBe(409);
    expect(
      await count(
        'select count(*) as n from credit_ledger where reason = ? and user_id = ?',
        'lesson',
        await userIdFor('ulang@example.com'),
      ),
    ).toBe(1);
  });

  it('kegagalan model menulis tepat satu pengembalian', async () => {
    const cookie = await signIn('gagal@example.com');
    await env.APP_KV.put('dev:ai-mode', 'fail');
    const started = await startPath(cookie);
    expect(await processGeneration(env, started.jobId, 3)).toBe('ack');
    expect(await processGeneration(env, started.jobId, 3)).toBe('ack');
    expect(
      await count(
        'select count(*) as n from credit_ledger where reason = ? and user_id = ?',
        'refund',
        await userIdFor('gagal@example.com'),
      ),
    ).toBe(1);
    expect(await balance(cookie)).toBe(24);
  });

  it('status kuis tidak menghalangi pelajaran yang sudah siap', async () => {
    const cookie = await signIn('kuis@example.com');
    const lessonId = await readyLesson(cookie);
    await env.DB.prepare("update chapter set quiz_status = 'retry'").run();
    const opened = await api(`/api/lessons/${lessonId}/open`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(opened.status).toBe(200);
    const body = await jsonBody<{ body: string | null }>(opened);
    expect(body.body).toBeTruthy();
  });

  it('masuk tidak mengubah hitungan hari', async () => {
    const cookie = await signIn('runtun@example.com', 'Runtun');
    await env.DB.prepare(
      'update user set streak_count = 4, streak_last_date = ? where email = ?',
    )
      .bind('2026-11-01', 'runtun@example.com')
      .run();
    const me = await api('/api/me', { cookie });
    const body = await jsonBody<{ streak: { count: number } }>(me);
    expect(body.streak.count).toBe(4);
    const row = await env.DB.prepare(
      'select streak_count as n from user where email = ?',
    )
      .bind('runtun@example.com')
      .first<{ n: number }>();
    expect(row?.n).toBe(4);
  });

  it('menyelesaikan pelajaran hanya menaikkan satu hari', async () => {
    const cookie = await signIn('selesai@example.com');
    const lessonId = await readyLesson(cookie);
    const first = await api(`/api/lessons/${lessonId}/complete`, {
      method: 'POST',
      json: {},
      cookie,
    });
    const second = await api(`/api/lessons/${lessonId}/complete`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const row = await env.DB.prepare(
      'select streak_count as n from user where email = ?',
    )
      .bind('selesai@example.com')
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('hitungan yang dimatikan tidak berubah saat pelajaran selesai', async () => {
    const cookie = await signIn('diam@example.com');
    const lessonId = await readyLesson(cookie);
    await env.DB.prepare(
      'update user set streak_enabled = 0, streak_count = 3 where email = ?',
    )
      .bind('diam@example.com')
      .run();
    const done = await api(`/api/lessons/${lessonId}/complete`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(done.status).toBe(200);
    const row = await env.DB.prepare(
      'select streak_count as n from user where email = ?',
    )
      .bind('diam@example.com')
      .first<{ n: number }>();
    expect(row?.n).toBe(3);
  });

  it('sumber dari model disimpan dan sitasinya dipetakan', async () => {
    const cookie = await signIn('sumber@example.com');
    const started = await startPath(cookie);
    await processGeneration(env, started.jobId, 1);
    const lessonId = await firstLesson(cookie, started.pathId);
    const opened = await api(`/api/lessons/${lessonId}/open`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(opened.status).toBe(202);
    expect(
      await processGeneration(
        env,
        (await jsonBody<{ jobId: string }>(opened)).jobId,
        1,
      ),
    ).toBe('ack');
    const web = await count(
      "select count(*) as n from lesson_source where lesson_id = ? and kind = 'web'",
      lessonId,
    );
    expect(web).toBeGreaterThan(0);
    expect(
      await count(
        'select count(*) as n from lesson_claim where lesson_id = ?',
        lessonId,
      ),
    ).toBe(0);
    const lesson = await env.DB.prepare(
      'select status, body from lesson where id = ?',
    )
      .bind(lessonId)
      .first<{ status: string; body: string }>();
    expect(lesson?.status).toBe('ready');
    expect(lesson?.body).toContain('[[');
    expect(lesson?.body).not.toContain('[[s1]]');
  });

  it('pelajar ditolak dari rute admin', async () => {
    const cookie = await signIn('pelajar-admin@example.com');
    const response = await api('/api/admin/users', { cookie });
    expect(response.status).toBe(403);
  });

  it('admin melihat ringkasan operasi', async () => {
    const cookie = await signIn('admin@example.com', 'Admin');
    const response = await api('/api/admin/stats', { cookie });
    expect(response.status).toBe(200);
    const body = await jsonBody<{ users: number }>(response);
    expect(body.users).toBeGreaterThanOrEqual(1);
  });

  it('admin tidak bisa menonaktifkan semua paket', async () => {
    const cookie = await signIn('admin@example.com', 'Admin');
    const list = await api('/api/admin/packs', { cookie });
    expect(list.status).toBe(200);
    const body = await jsonBody<{ packs: { id: string; active: number }[] }>(
      list,
    );
    const packs = body.packs.map((p) => ({
      id: p.id,
      name: 'x',
      credits: 10,
      priceIdr: 10000,
      active: false,
      sort: 0,
    }));
    const response = await api('/api/admin/packs', {
      cookie,
      method: 'PUT',
      json: { packs },
    });
    expect(response.status).toBe(400);
  });

  it('admin mengunduh ekspor buku besar', async () => {
    const cookie = await signIn('admin@example.com', 'Admin');
    const response = await api('/api/admin/ledger/export', { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const text = await response.text();
    expect(text.startsWith('tanggal,email,nama')).toBe(true);
  });

  it('admin biasa ditolak dari paket platform', async () => {
    await signIn('admin-kedua@example.com', 'Admin Kedua');
    const cookie = await signIn('admin@example.com', 'Admin');
    await api(
      `/api/admin/users/${await userIdFor('admin-kedua@example.com')}`,
      {
        cookie,
        method: 'PATCH',
        json: { role: 'admin' },
      },
    );
    const other = await signIn('admin-kedua@example.com', 'Admin Kedua');
    const response = await api('/api/admin/packs', { cookie: other });
    expect(response.status).toBe(403);
  });
});

describe('webhook pembayaran', () => {
  it('menolak tanda tangan yang salah', async () => {
    const response = await webhook(
      {
        event_type: 'payment.completed',
        data: { payment_id: 'pay_x', order_id: 'ord_x', amount: 25000 },
      },
      'salah',
    );
    expect(response.status).toBe(401);
  });

  it('webhook yang diulang tidak menulis kredit kedua', async () => {
    const cookie = await signIn('bayar@example.com');
    const order = await createOrder(cookie);
    const payload = {
      event_type: 'payment.completed',
      data: {
        payment_id: `pay_${order.orderId}`,
        order_id: order.orderId,
        amount: 25000,
        status: 'completed',
      },
    };
    const first = await webhook(payload, undefined, 'evt_sama');
    const second = await webhook(payload, undefined, 'evt_sama');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(
      await count(
        'select count(*) as n from credit_ledger where reason = ? and user_id = ?',
        'purchase',
        await userIdFor('bayar@example.com'),
      ),
    ).toBe(1);
  });

  it('jumlah yang tidak cocok tidak menambah kredit', async () => {
    const cookie = await signIn('jumlah@example.com');
    const order = await createOrder(cookie);
    const response = await webhook({
      event_type: 'payment.completed',
      data: {
        payment_id: `pay_${order.orderId}`,
        order_id: order.orderId,
        amount: 1,
        status: 'completed',
      },
    });
    expect(response.status).toBe(200);
    expect(
      await count(
        'select count(*) as n from credit_ledger where reason = ? and user_id = ?',
        'purchase',
        await userIdFor('jumlah@example.com'),
      ),
    ).toBe(0);
    const row = await env.DB.prepare(
      'select status from credit_order where order_id = ?',
    )
      .bind(order.orderId)
      .first<{ status: string }>();
    expect(row?.status).toBe('failed');
  });
});

async function startPath(
  cookie: string,
): Promise<{ pathId: string; jobId: string }> {
  const response = await api('/api/paths', {
    method: 'POST',
    json: { topic: 'Merawat tanaman kopi di rumah' },
    cookie,
  });
  expect(response.status).toBe(202);
  return jsonBody(response);
}

async function firstLesson(cookie: string, pathId: string): Promise<string> {
  const response = await api(`/api/paths/${pathId}`, { cookie });
  const body = await jsonBody<{ chapters: { lessons: { id: string }[] }[] }>(
    response,
  );
  const lessonId = body.chapters[0]?.lessons[0]?.id;
  if (!lessonId) throw new Error('pelajaran tidak ada');
  return lessonId;
}

async function readyLesson(cookie: string): Promise<string> {
  const started = await startPath(cookie);
  expect(await processGeneration(env, started.jobId, 1)).toBe('ack');
  const lessonId = await firstLesson(cookie, started.pathId);
  const opened = await api(`/api/lessons/${lessonId}/open`, {
    method: 'POST',
    json: {},
    cookie,
  });
  expect(opened.status).toBe(202);
  const job = await jsonBody<{ jobId: string }>(opened);
  expect(await processGeneration(env, job.jobId, 1)).toBe('ack');
  return lessonId;
}

async function balance(cookie: string): Promise<number> {
  const response = await api('/api/me', { cookie });
  const body = await jsonBody<{ balance: number }>(response);
  return body.balance;
}

async function createOrder(cookie: string): Promise<{ orderId: string }> {
  const response = await api('/api/credit-orders', {
    method: 'POST',
    json: { packId: 'pack_singkat' },
    cookie,
  });
  expect(response.status).toBe(200);
  return jsonBody(response);
}

async function webhook(
  payload: unknown,
  signature?: string,
  svixId = `evt_${crypto.randomUUID()}`,
): Promise<Response> {
  const raw = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signed =
    signature ?? (await signSvix(raw, webhookSecret, svixId, timestamp));
  return api('/api/webhooks/sumopod', {
    method: 'POST',
    body: raw,
    headers: {
      'content-type': 'application/json',
      'svix-id': svixId,
      'svix-timestamp': String(timestamp),
      'svix-signature': signed,
    },
  });
}

async function userIdFor(email: string): Promise<string> {
  const row = await env.DB.prepare('select id from user where email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (!row) throw new Error('pengguna tidak ada');
  return row.id;
}

async function count(sql: string, ...binds: string[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}
