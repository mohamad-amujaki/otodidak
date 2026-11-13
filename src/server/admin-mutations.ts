import { asc, eq } from 'drizzle-orm';
import { debitIfEnough } from '../billing/ledger';
import type { Database } from '../db/client';
import {
  aiModels,
  aiProviders,
  appConfig,
  creditPacks,
  promptTemplates,
  type UserRow,
  users,
} from '../db/schema';
import { AppError, errorMessage } from '../domain/errors';
import { assertAllowedLlmBaseUrl } from '../domain/provider-url';
import {
  adminAdjustSchema,
  adminUserSchema,
  configSchema,
  modelSchema,
  packsSchema,
  promptSchema,
  taskSchema,
} from '../domain/schemas';
import { nowIso } from '../domain/time';
import { eraseLearning } from './account';
import { isSuperadmin } from './admin-access';

function knownSecret(env: Env, name: string): boolean {
  if (!/^[A-Z0-9_]+$/.test(name)) return false;
  switch (name) {
    case 'OPENAI_API_KEY':
      return env.OPENAI_API_KEY.length > 0;
    case 'BRAVE_SEARCH_API_KEY':
      return env.BRAVE_SEARCH_API_KEY.length > 0;
    case 'YOUTUBE_API_KEY':
      return env.YOUTUBE_API_KEY.length > 0;
    default:
      return false;
  }
}

function assertSuperadmin(env: Env, actor: UserRow) {
  if (!isSuperadmin(env, actor.email)) throw new AppError('forbidden');
}

function readTask(value: string) {
  const parsed = taskSchema.safeParse(value);
  if (!parsed.success) throw new AppError('not_found');
  return parsed.data;
}

export async function patchAdminUser(
  db: Database,
  env: Env,
  actor: UserRow,
  userId: string,
  raw: unknown,
): Promise<void> {
  const body = adminUserSchema.parse(raw);
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const target = rows[0];
  if (!target) throw new AppError('not_found');
  if (
    body.role === 'admin' &&
    target.role !== 'admin' &&
    !isSuperadmin(env, actor.email)
  ) {
    throw new AppError('forbidden');
  }
  if (
    target.id === actor.id &&
    (body.status === 'suspended' || body.role === 'learner')
  ) {
    throw new AppError(
      'validation',
      'Kamu tidak bisa menahan atau menurunkan akunmu sendiri.',
    );
  }
  await db
    .update(users)
    .set({
      role: body.role ?? target.role,
      status: body.status ?? target.status,
      updatedAt: nowIso(),
    })
    .where(eq(users.id, target.id));
}

export async function adminEraseUserLearning(
  db: Database,
  userId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows[0]) throw new AppError('not_found');
  await eraseLearning(db, rows[0].id);
}

export async function adminAdjustLedger(
  db: Database,
  env: Env,
  actor: UserRow,
  userId: string,
  raw: unknown,
): Promise<number> {
  assertSuperadmin(env, actor);
  const body = adminAdjustSchema.parse(raw);
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows[0]) throw new AppError('not_found');
  const result = await debitIfEnough(db, {
    userId: rows[0].id,
    amount: body.amount,
    reason: 'admin_adjust',
    refType: 'admin',
    refId: actor.id,
    idempotencyKey: `admin:${crypto.randomUUID()}`,
    note: body.note,
  });
  if (result !== 'inserted') throw new AppError('insufficient_credits');
  const { balanceOf } = await import('../billing/ledger');
  return balanceOf(db, rows[0].id);
}

export async function updateAppConfig(
  db: Database,
  env: Env,
  actor: UserRow,
  raw: unknown,
): Promise<void> {
  assertSuperadmin(env, actor);
  const body = configSchema.parse(raw);
  await db.update(appConfig).set(body).where(eq(appConfig.id, 'app'));
}

export async function updatePromptTemplate(
  db: Database,
  env: Env,
  actor: UserRow,
  taskRaw: string,
  raw: unknown,
): Promise<void> {
  assertSuperadmin(env, actor);
  const task = readTask(taskRaw);
  const body = promptSchema.parse(raw);
  await db
    .update(promptTemplates)
    .set({
      body: body.body,
      updatedAt: nowIso(),
      updatedBy: actor.id,
    })
    .where(eq(promptTemplates.task, task));
}

export async function updateModelForTask(
  db: Database,
  env: Env,
  actor: UserRow,
  taskRaw: string,
  raw: unknown,
): Promise<void> {
  assertSuperadmin(env, actor);
  const task = readTask(taskRaw);
  const body = modelSchema.parse(raw);
  if (
    body.authKind !== 'workers_ai_binding' &&
    body.secretName &&
    !knownSecret(env, body.secretName)
  ) {
    throw new AppError(
      'validation',
      'Nama secret tidak ada di lingkungan Worker.',
    );
  }
  const rows = await db
    .select()
    .from(aiModels)
    .where(eq(aiModels.task, task))
    .limit(1);
  const model = rows[0];
  if (!model) throw new AppError('not_found');
  const providerRows = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.id, model.providerId))
    .limit(1);
  const provider = providerRows[0];
  if (!provider) throw new AppError('not_found');
  const nextBaseUrl = body.baseUrl ?? provider.baseUrl;
  assertAllowedLlmBaseUrl(nextBaseUrl);
  await db.batch([
    db.update(aiModels).set({ active: 0 }).where(eq(aiModels.task, task)),
    db
      .update(aiModels)
      .set({
        active: 1,
        modelName: body.modelName,
        maxOutputTokens: body.maxOutputTokens,
        timeoutMs: body.timeoutMs,
      })
      .where(eq(aiModels.id, model.id)),
    db
      .update(aiProviders)
      .set({
        baseUrl: nextBaseUrl,
        secretName:
          body.authKind === 'workers_ai_binding'
            ? null
            : (body.secretName ?? provider.secretName),
        authKind: body.authKind ?? provider.authKind,
      })
      .where(eq(aiProviders.id, model.providerId)),
  ]);
}

export async function updateCreditPacks(
  db: Database,
  env: Env,
  actor: UserRow,
  raw: unknown,
): Promise<void> {
  assertSuperadmin(env, actor);
  const body = packsSchema.parse(raw);
  const rows = await db
    .select()
    .from(creditPacks)
    .orderBy(asc(creditPacks.sort));
  const activeById = new Map(rows.map((row) => [row.id, row.active === 1]));
  for (const pack of body.packs) {
    if (pack.credits < 1 || pack.priceIdr < 1)
      throw new AppError('validation', 'Kredit dan harga harus positif.');
    const id = pack.id ?? `pack_${crypto.randomUUID()}`;
    activeById.set(id, pack.active);
  }
  const activeCount = [...activeById.values()].filter(Boolean).length;
  if (activeCount < 1)
    throw new AppError('validation', 'Minimal satu paket aktif.');
  for (const pack of body.packs) {
    const id = pack.id ?? `pack_${crypto.randomUUID()}`;
    const values = {
      name: pack.name,
      credits: pack.credits,
      priceIdr: pack.priceIdr,
      active: pack.active ? 1 : 0,
      sort: pack.sort,
    };
    const existing = rows.find((row) => row.id === id);
    if (existing)
      await db.update(creditPacks).set(values).where(eq(creditPacks.id, id));
    else await db.insert(creditPacks).values({ id, ...values });
  }
}

export function appErrorToMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return errorMessage.validation;
}
