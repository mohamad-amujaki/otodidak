/// <reference path="../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const tables = [
  'quiz_attempt',
  'quiz_question',
  'quiz',
  'lesson_claim',
  'lesson_source',
  'lesson',
  'chapter',
  'generation_job',
  'path',
  'payment_event',
  'credit_order',
  'credit_ledger',
  'user',
];

beforeEach(async () => {
  for (const table of tables) {
    await env.DB.prepare(`delete from ${table}`).run();
  }
  const listed = await env.APP_KV.list();
  for (const key of listed.keys) await env.APP_KV.delete(key.name);
});
