import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { database, ensureUser } from '../src/server/account';

async function countByEmail(email: string): Promise<number> {
  const row = await env.DB.prepare(
    'select count(*) as n from user where lower(email) = ?',
  )
    .bind(email.toLowerCase())
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe('identitas pengguna', () => {
  it('menyatukan akun saat Clerk ID berganti untuk email yang sama', async () => {
    const db = await database(env);
    const first = await ensureUser(db, env, {
      clerkUserId: 'user_test_1',
      email: 'sama@example.com',
      name: 'Sama',
    });
    expect(await countByEmail('sama@example.com')).toBe(1);

    // Clerk instance baru memberi user id berbeda untuk email yang sama.
    const second = await ensureUser(db, env, {
      clerkUserId: 'user_live_1',
      email: 'SAMA@example.com',
      name: 'Sama Baru',
    });
    expect(second.id).toBe(first.id);
    expect(second.clerkUserId).toBe('user_live_1');
    expect(second.name).toBe('Sama Baru');
    expect(await countByEmail('sama@example.com')).toBe(1);

    // Panggilan berikutnya dengan Clerk ID baru tetap menemukan baris yang sama.
    const again = await ensureUser(db, env, {
      clerkUserId: 'user_live_1',
      email: 'sama@example.com',
      name: 'Sama Baru',
    });
    expect(again.id).toBe(first.id);
    expect(await countByEmail('sama@example.com')).toBe(1);
  });

  it('tetap membuat akun berbeda untuk email yang berbeda', async () => {
    const db = await database(env);
    const a = await ensureUser(db, env, {
      clerkUserId: 'user_a',
      email: 'a@example.com',
      name: 'A',
    });
    const b = await ensureUser(db, env, {
      clerkUserId: 'user_b',
      email: 'b@example.com',
      name: 'B',
    });
    expect(a.id).not.toBe(b.id);
    expect(await countByEmail('a@example.com')).toBe(1);
    expect(await countByEmail('b@example.com')).toBe(1);
  });
});
