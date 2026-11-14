import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { UserRow } from '../src/db/schema';
import { configFieldGroups } from '../src/domain/admin-labels';
import { SEED_CONFIG } from '../src/domain/defaults';
import { configSchema } from '../src/domain/schemas';
import { database, loadConfig } from '../src/server/account';
import { updateAppConfig } from '../src/server/admin-mutations';
import { signIn } from './helpers';

const groupKeys = [...new Set(Object.values(configFieldGroups).flat())];

function payloadFrom(overrides: Record<string, number> = {}) {
  const payload: Record<string, number> = {};
  for (const key of groupKeys)
    payload[key] = Number(
      (SEED_CONFIG as unknown as Record<string, number>)[key],
    );
  return { ...payload, ...overrides };
}

async function adminActor(): Promise<UserRow> {
  const row = await env.DB.prepare('select * from user where email = ?')
    .bind('admin@example.com')
    .first<UserRow>();
  if (!row) throw new Error('admin tidak ada');
  return row;
}

describe('form konfigurasi admin', () => {
  it('grup form mencakup semua field di configSchema', () => {
    expect([...groupKeys].sort()).toEqual(
      Object.keys(configSchema.shape).sort(),
    );
  });

  it('payload yang dibangun dari grup form lolos validasi', () => {
    expect(configSchema.safeParse(payloadFrom()).success).toBe(true);
  });

  it('menyimpan perubahan dan menolak payload yang kurang lengkap', async () => {
    const db = await database(env);
    await signIn('admin@example.com', 'Admin');
    const actor = await adminActor();
    const before = await loadConfig(db);

    try {
      await updateAppConfig(db, env, actor, payloadFrom({ maxChapters: 5 }));
      expect((await loadConfig(db)).maxChapters).toBe(5);

      const incomplete = payloadFrom({ maxChapters: 5 });
      delete incomplete.adminDailyCreditCap;
      await expect(
        updateAppConfig(db, env, actor, incomplete),
      ).rejects.toThrowError(/Konfigurasi tidak valid/);
      expect((await loadConfig(db)).maxChapters).toBe(5);
    } finally {
      await updateAppConfig(db, env, actor, {
        maxChapters: before.maxChapters,
        maxLessonsPerChapter: before.maxLessonsPerChapter,
        quizQuestionCount: before.quizQuestionCount,
        quizPassPercent: before.quizPassPercent,
        costRoadmap: before.costRoadmap,
        costLesson: before.costLesson,
        costQuiz: before.costQuiz,
        signupCredits: before.signupCredits,
        lessonMinuteLabel: before.lessonMinuteLabel,
        adminDailyCreditCap: before.adminDailyCreditCap,
      });
    }
  });
});
