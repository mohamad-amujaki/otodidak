import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { UserRow } from '../src/db/schema';
import { adminMessageTone } from '../src/domain/admin-labels';
import { database } from '../src/server/account';
import { adminAdjustLedgerBulk } from '../src/server/admin-mutations';
import { api, jsonBody, signIn } from './helpers';

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

async function adjustCount(userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "select count(*) as total from credit_ledger where user_id = ? and reason = 'admin_adjust'",
  )
    .bind(userId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

describe('penyesuaian kredit oleh admin', () => {
  it('menambah sekali walau nonce yang sama dikirim dua kali', async () => {
    await database(env);
    const admin = await signIn('admin@example.com', 'Admin');
    await signIn('target-kredit@example.com', 'Target');
    const targetId = await userIdOf('target-kredit@example.com');
    const before = await balanceOf(targetId);

    const payload = {
      amount: 25,
      note: 'uji idempoten',
      nonce: 'nonce-uji-0001',
    };
    const first = await api(`/api/admin/users/${targetId}/ledger`, {
      method: 'POST',
      json: payload,
      cookie: admin,
    });
    expect(first.status).toBe(200);
    const firstBody = await jsonBody<{ status: string; balance: number }>(
      first,
    );
    expect(firstBody.status).toBe('applied');
    expect(firstBody.balance).toBe(before + 25);

    const second = await api(`/api/admin/users/${targetId}/ledger`, {
      method: 'POST',
      json: payload,
      cookie: admin,
    });
    expect(second.status).toBe(200);
    const secondBody = await jsonBody<{ status: string; balance: number }>(
      second,
    );
    expect(secondBody.status).toBe('duplicate');
    expect(secondBody.balance).toBe(before + 25);
    expect(await balanceOf(targetId)).toBe(before + 25);
    expect(await adjustCount(targetId)).toBe(1);
  });

  it('tetap menambah lagi kalau nonce berbeda', async () => {
    await database(env);
    const admin = await signIn('admin@example.com', 'Admin');
    await signIn('target-kredit-2@example.com', 'Target Dua');
    const targetId = await userIdOf('target-kredit-2@example.com');
    const before = await balanceOf(targetId);

    for (const nonce of ['nonce-uji-0002', 'nonce-uji-0003']) {
      const response = await api(`/api/admin/users/${targetId}/ledger`, {
        method: 'POST',
        json: { amount: 5, note: 'uji dua kali', nonce },
        cookie: admin,
      });
      expect(response.status).toBe(200);
      expect((await jsonBody<{ status: string }>(response)).status).toBe(
        'applied',
      );
    }
    expect(await balanceOf(targetId)).toBe(before + 10);
    expect(await adjustCount(targetId)).toBe(2);
  });

  it('menolak penyesuaian negatif yang melewati saldo', async () => {
    await database(env);
    const admin = await signIn('admin@example.com', 'Admin');
    await signIn('target-kredit-3@example.com', 'Target Tiga');
    const targetId = await userIdOf('target-kredit-3@example.com');
    const before = await balanceOf(targetId);

    const response = await api(`/api/admin/users/${targetId}/ledger`, {
      method: 'POST',
      json: {
        amount: -(before + 10),
        note: 'uji saldo negatif',
        nonce: 'nonce-uji-0004',
      },
      cookie: admin,
    });
    expect(response.status).toBe(402);
    expect(await balanceOf(targetId)).toBe(before);
    expect(await adjustCount(targetId)).toBe(0);
  });

  it('menolak jumlah nol', async () => {
    await database(env);
    const admin = await signIn('admin@example.com', 'Admin');
    await signIn('target-kredit-4@example.com', 'Target Empat');
    const targetId = await userIdOf('target-kredit-4@example.com');

    const response = await api(`/api/admin/users/${targetId}/ledger`, {
      method: 'POST',
      json: { amount: 0, note: 'nol tidak boleh', nonce: 'nonce-uji-0005' },
      cookie: admin,
    });
    expect(response.status).toBe(400);
  });
});

async function adminActor(email: string): Promise<UserRow> {
  const row = await env.DB.prepare('select * from user where email = ?')
    .bind(email)
    .first<UserRow>();
  if (!row) throw new Error('admin tidak ada');
  return row;
}

describe('penyesuaian kredit massal', () => {
  it('memberi ke beberapa pengguna sekali walau nonce sama', async () => {
    const db = await database(env);
    await signIn('admin@example.com', 'Admin');
    const actor = await adminActor('admin@example.com');
    await signIn('bulk-a@example.com', 'Bulk A');
    await signIn('bulk-b@example.com', 'Bulk B');
    const ids = [
      await userIdOf('bulk-a@example.com'),
      await userIdOf('bulk-b@example.com'),
    ];
    const before = await Promise.all(ids.map((id) => balanceOf(id)));

    const payload = {
      userIds: ids,
      amount: 15,
      note: 'uji massal',
      nonce: 'nonce-massal-0001',
    };
    const first = await adminAdjustLedgerBulk(db, env, actor, payload);
    expect(first).toMatchObject({ applied: 2, duplicate: 0, insufficient: 0 });
    for (const [index, id] of ids.entries()) {
      expect(await balanceOf(id)).toBe((before[index] ?? 0) + 15);
    }

    const second = await adminAdjustLedgerBulk(db, env, actor, payload);
    expect(second).toMatchObject({ applied: 0, duplicate: 2 });
    for (const [index, id] of ids.entries()) {
      expect(await balanceOf(id)).toBe((before[index] ?? 0) + 15);
    }
  });

  it('melewati pengguna yang saldonya tidak cukup dan id tak dikenal', async () => {
    const db = await database(env);
    await signIn('admin@example.com', 'Admin');
    const actor = await adminActor('admin@example.com');
    await signIn('bulk-c@example.com', 'Bulk C');
    await signIn('bulk-d@example.com', 'Bulk D');
    const enough = await userIdOf('bulk-c@example.com');
    const short = await userIdOf('bulk-d@example.com');

    await adminAdjustLedgerBulk(db, env, actor, {
      userIds: [short],
      amount: -(await balanceOf(short)),
      note: 'kosongkan saldo',
      nonce: 'nonce-massal-0002',
    });
    const enoughBefore = await balanceOf(enough);

    const outcome = await adminAdjustLedgerBulk(db, env, actor, {
      userIds: [enough, short, 'user-tidak-ada'],
      amount: -5,
      note: 'uji campuran',
      nonce: 'nonce-massal-0003',
    });
    expect(outcome).toMatchObject({
      applied: 1,
      insufficient: 1,
      missing: 1,
    });
    expect(await balanceOf(enough)).toBe(enoughBefore - 5);
    expect(await balanceOf(short)).toBe(0);
  });

  it('menolak daftar kosong dan jumlah nol', async () => {
    const db = await database(env);
    await signIn('admin@example.com', 'Admin');
    const actor = await adminActor('admin@example.com');
    await expect(
      adminAdjustLedgerBulk(db, env, actor, {
        userIds: [],
        amount: 10,
        note: 'kosong',
      }),
    ).rejects.toThrow();
    await expect(
      adminAdjustLedgerBulk(db, env, actor, {
        userIds: ['x'],
        amount: 0,
        note: 'nol',
      }),
    ).rejects.toThrow();
  });
});

describe('nada pesan admin', () => {
  it('memilih tone sesuai isi pesan', () => {
    expect(adminMessageTone('Kredit ditambah 100. Saldo baru 1.340.')).toBe(
      'success',
    );
    expect(
      adminMessageTone('Gagal: pengurangan itu akan membuat saldo negatif.'),
    ).toBe('danger');
    expect(
      adminMessageTone('Tidak ada perubahan. Dilewati: 1 saldo tidak cukup.'),
    ).toBe('warning');
    expect(
      adminMessageTone(
        'Aksi ini sudah diterapkan sebelumnya. Saldo tidak berubah.',
      ),
    ).toBe('warning');
  });
});
