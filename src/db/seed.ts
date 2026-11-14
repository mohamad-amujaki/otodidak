import {
  DEFAULT_AI_BASE_URL,
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
      name: 'deepseek-compatible',
      baseUrl: DEFAULT_AI_BASE_URL,
      authKind: 'bearer',
      secretName: 'OPENAI_API_KEY',
      active: 1,
    })
    .onConflictDoNothing();
  for (const model of SEED_MODELS) {
    await db
      .insert(aiModels)
      .values({
        id: model.id,
        providerId: SEED_PROVIDER_ID,
        modelName: DEFAULT_MODEL_NAME,
        task: model.task,
        active: 1,
        maxOutputTokens: model.maxOutputTokens,
        timeoutMs: model.timeoutMs,
      })
      .onConflictDoNothing();
  }
  for (const task of ['roadmap', 'lesson', 'quiz'] as const) {
    await db
      .insert(promptTemplates)
      .values({
        task,
        body: SEED_PROMPTS[task],
        updatedAt: now,
        updatedBy: null,
      })
      .onConflictDoNothing();
  }
  await db
    .insert(sourceProviders)
    .values([
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
