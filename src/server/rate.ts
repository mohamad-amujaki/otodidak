import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  IP_GENERATE_LIMIT,
  IP_WEBHOOK_LIMIT,
  JOB_RATE_LIMIT,
  JOB_RATE_WINDOW_MS,
} from '../domain/defaults';
import { AppError } from '../domain/errors';

/** Batas generasi per pengguna dari D1 (tanpa race KV read–modify–write). */
export async function recentGenerationCount(
  db: Database,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - JOB_RATE_WINDOW_MS).toISOString();
  const row = await db.get<{ n: number | null }>(sql`
    select (
      (select count(*) from generation_job
        where user_id = ${userId} and created_at >= ${since})
      +
      (select count(*) from credit_ledger
        where user_id = ${userId} and reason = 'outline' and created_at >= ${since})
    ) as n
  `);
  return Number(row?.n ?? 0);
}

export async function assertUserGenerationRate(
  db: Database,
  userId: string,
): Promise<void> {
  if ((await recentGenerationCount(db, userId)) >= JOB_RATE_LIMIT)
    throw new AppError('rate_limited');
}

export async function allowGenerateIp(
  kv: KVNamespace,
  request: Request,
): Promise<boolean> {
  return consume(
    kv,
    `rate:ip:gen:${clientIp(request)}`,
    IP_GENERATE_LIMIT,
    60_000,
  );
}

export async function allowWebhookIp(
  kv: KVNamespace,
  request: Request,
): Promise<boolean> {
  return consume(
    kv,
    `rate:ip:hook:${clientIp(request)}`,
    IP_WEBHOOK_LIMIT,
    60_000,
  );
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local';
}

async function consume(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowMs: number,
  record = true,
): Promise<boolean> {
  const now = Date.now();
  const raw = await kv.get(key);
  let stamps: number[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed))
        stamps = parsed.filter(
          (item): item is number => typeof item === 'number',
        );
    } catch {
      stamps = [];
    }
  }
  stamps = stamps.filter((stamp) => now - stamp < windowMs);
  if (stamps.length >= limit) return false;
  if (!record) return true;
  stamps.push(now);
  await kv.put(key, JSON.stringify(stamps), {
    expirationTtl: Math.max(60, Math.ceil(windowMs / 1000)),
  });
  return true;
}
