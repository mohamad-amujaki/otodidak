import {
  IP_GENERATE_LIMIT,
  IP_WEBHOOK_LIMIT,
  JOB_RATE_LIMIT,
  JOB_RATE_WINDOW_MS,
} from '../domain/defaults';

export async function jobsWithinLimit(
  kv: KVNamespace,
  userId: string,
): Promise<boolean> {
  return consume(
    kv,
    `rate:jobs:${userId}`,
    JOB_RATE_LIMIT,
    JOB_RATE_WINDOW_MS,
    false,
  );
}

export async function recordJob(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await consume(
    kv,
    `rate:jobs:${userId}`,
    JOB_RATE_LIMIT,
    JOB_RATE_WINDOW_MS,
    true,
  );
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
