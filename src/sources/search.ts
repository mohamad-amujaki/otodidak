import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { sourceProviders } from '../db/schema';
import { MAX_WEB_SOURCES, MAX_YOUTUBE_SOURCES } from '../domain/defaults';
import { assertAllowedSourceBaseUrl } from '../domain/provider-url';
import { logEvent } from '../server/log';

export type SourceHit = { title: string; url: string };

export async function searchWeb(
  env: Env,
  db: Database,
  query: string,
): Promise<SourceHit[]> {
  const provider = await activeProvider(db, 'web');
  if (!provider) return [];
  const key = env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  if (key === 'mock' || key === 'empty' || key === 'fail')
    return mockSearch(env, key, query, 'web');
  assertAllowedSourceBaseUrl(provider.baseUrl, 'web');
  const url = new URL(provider.baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('count', '1');
  const response = await fetch(url, {
    headers: { 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('source_failed');
  const payload = (await response.json()) as {
    web?: {
      results?: { title?: string; url?: string; description?: string }[];
    };
  };
  const results: SourceHit[] = [];
  for (const result of payload.web?.results ?? []) {
    if (!result.url || !result.title) continue;
    results.push({ title: result.title, url: result.url });
    if (results.length >= MAX_WEB_SOURCES) break;
  }
  return results;
}

export async function searchYouTube(
  env: Env,
  db: Database,
  query: string,
): Promise<SourceHit | null> {
  const provider = await activeProvider(db, 'youtube');
  if (!provider) return null;
  const key = env.YOUTUBE_API_KEY;
  if (!key) return null;
  if (key === 'mock' || key === 'empty' || key === 'fail') {
    const hits = await mockSearch(env, key, query, 'youtube');
    return hits[0] ?? null;
  }
  assertAllowedSourceBaseUrl(provider.baseUrl, 'youtube');
  const url = new URL(provider.baseUrl);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('q', query);
  url.searchParams.set('key', key);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('source_failed');
  const payload = (await response.json()) as {
    items?: {
      id?: { videoId?: string };
      snippet?: { title?: string; channelTitle?: string };
    }[];
  };
  const item = payload.items?.[0];
  const videoId = item?.id?.videoId;
  const title = item?.snippet?.title;
  const channel = item?.snippet?.channelTitle;
  if (!videoId || !title) return null;
  return {
    title: `${title} — ${channel ?? 'YouTube'}`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

async function activeProvider(db: Database, kind: 'web' | 'youtube') {
  const rows = await db
    .select()
    .from(sourceProviders)
    .where(and(eq(sourceProviders.kind, kind), eq(sourceProviders.active, 1)))
    .limit(1);
  return rows[0] ?? null;
}

async function mockSearch(
  env: Env,
  key: string,
  query: string,
  kind: 'web' | 'youtube',
): Promise<SourceHit[]> {
  const mode =
    key === 'empty' || key === 'fail'
      ? key
      : await env.APP_KV.get('dev:search-mode');
  if (mode === 'fail') {
    logEvent({ message: 'source_failed', errorCode: 'source_failed' });
    throw new Error('source_failed');
  }
  if (mode === 'empty' || query.includes('tanpa-hasil')) return [];
  if (kind === 'youtube') {
    return [
      {
        title: 'Contoh video — Kanal Contoh',
        url: 'https://www.youtube.com/watch?v=mockvideo0001',
      },
    ].slice(0, MAX_YOUTUBE_SOURCES);
  }
  return [{ title: 'Sumber contoh', url: 'https://example.com/sumber' }];
}
