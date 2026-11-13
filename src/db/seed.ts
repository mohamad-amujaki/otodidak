import {
  DEFAULT_MODEL_NAME,
  SEED_CONFIG,
  SEED_MODELS,
  SEED_PACKS,
  SEED_PROVIDER_ID,
} from '../domain/defaults';
import { SEED_PROMPTS } from '../domain/prompts';
import { nowIso } from '../domain/time';
import type { Database } from './client';
import {
  aiModels,
  aiProviders,
  appConfig,
  creditPacks,
  promptTemplates,
  sourceProviders,
} from './schema';

export async function ensureSeed(db: Database): Promise<void> {
  const now = nowIso();
  await db.insert(appConfig).values(SEED_CONFIG).onConflictDoNothing();
  await db
    .insert(creditPacks)
    .values([...SEED_PACKS])
    .onConflictDoNothing();
  await db
    .insert(aiProviders)
    .values({
      id: SEED_PROVIDER_ID,
      name: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      authKind: 'bearer',
      secretName: 'OPENAI_API_KEY',
      active: 1,
    })
    .onConflictDoNothing();
  await db
    .insert(aiModels)
    .values(
      SEED_MODELS.map((model) => ({
        id: model.id,
        providerId: SEED_PROVIDER_ID,
        modelName: DEFAULT_MODEL_NAME,
        task: model.task,
        active: 1,
        maxOutputTokens: model.maxOutputTokens,
        timeoutMs: model.timeoutMs,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(promptTemplates)
    .values([
      {
        task: 'roadmap' as const,
        body: SEED_PROMPTS.roadmap,
        updatedAt: now,
        updatedBy: null,
      },
      {
        task: 'lesson' as const,
        body: SEED_PROMPTS.lesson,
        updatedAt: now,
        updatedBy: null,
      },
      {
        task: 'quiz' as const,
        body: SEED_PROMPTS.quiz,
        updatedAt: now,
        updatedBy: null,
      },
    ])
    .onConflictDoNothing();
  await db
    .insert(sourceProviders)
    .values([
      {
        id: 'source_brave',
        kind: 'web' as const,
        name: 'brave',
        baseUrl: 'https://api.search.brave.com/res/v1/web/search',
        secretName: 'BRAVE_SEARCH_API_KEY',
        active: 1,
      },
      {
        id: 'source_youtube',
        kind: 'youtube' as const,
        name: 'youtube',
        baseUrl: 'https://www.googleapis.com/youtube/v3/search',
        secretName: 'YOUTUBE_API_KEY',
        active: 1,
      },
    ])
    .onConflictDoNothing();
}
