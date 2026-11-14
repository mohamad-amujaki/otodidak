import { asc, eq, inArray, sql } from 'drizzle-orm';
import { debitIfEnough } from '../billing/ledger';
import type { Database } from '../db/client';
import {
  aiModels,
  aiProviders,
  appConfig,
  creditPacks,
  promptTemplates,
  promptVersions,
  type UserRow,
  users,
} from '../db/schema';
import { AppError, errorMessage } from '../domain/errors';
import { assertAllowedLlmBaseUrl } from '../domain/provider-url';
import {
  adminAdjustSchema,
  adminBulkAdjustSchema,
  adminUserSchema,
  configSchema,
  modelSchema,
  packsSchema,
  promptSchema,
  taskSchema,
} from '../domain/schemas';
import { nowIso } from '../domain/time';
import { eraseLearning, loadConfig } from './account';
import { assertSuperadmin, isSuperadmin } from './admin-access';
import { recordAdminAudit } from './admin-audit';

function knownSecret(env: Env, name: string): boolean {
  if (!/^[A-Z0-9_]+$/.test(name)) return false;
  switch (name) {
    case 'OPENAI_API_KEY':
      return env.OPENAI_API_KEY.length > 0;
    case 'YOUTUBE_API_KEY':
      return env.YOUTUBE_API_KEY.length > 0;
    default:
      return false;
  }
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
  const nextRole = body.role ?? target.role;
  const nextStatus = body.status ?? target.status;
  if (
    target.id === actor.id &&
    (nextStatus === 'suspended' || nextRole === 'learner')
  ) {
    throw new AppError(
      'validation',
      'Kamu tidak bisa menahan atau menurunkan akunmu sendiri.',
    );
  }
  const actorIsSuperadmin = isSuperadmin(env, actor.email);
  if (!actorIsSuperadmin && (target.role === 'admin' || nextRole === 'admin')) {
    throw new AppError(
      'forbidden',
      'Akses ditolak. Hanya superadmin yang bisa mengubah peran atau status admin.',
    );
  }
  if (
    target.role === 'admin' &&
    (nextRole !== 'admin' || nextStatus !== 'active')
  ) {
    const others = await countOtherActiveSuperadmins(db, env, target.id);
    if (others < 1)
      throw new AppError(
        'validation',
        'Gagal: superadmin terakhir tidak bisa diturunkan atau ditahan.',
      );
  }
  if (nextRole === target.role && nextStatus === target.status) return;
  await db
    .update(users)
    .set({ role: nextRole, status: nextStatus, updatedAt: nowIso() })
    .where(eq(users.id, target.id));
  await recordAdminAudit(db, {
    actorId: actor.id,
    action: 'user_update',
    targetId: target.id,
    detail: `${target.role}/${target.status} menjadi ${nextRole}/${nextStatus}`,
  });
}

async function countOtherActiveSuperadmins(
  db: Database,
  env: Env,
  exceptUserId: string,
): Promise<number> {
  const rows = await db.select().from(users).where(eq(users.role, 'admin'));
  return rows.filter(
    (row) =>
      row.id !== exceptUserId &&
      row.status === 'active' &&
      isSuperadmin(env, row.email),
  ).length;
}

export async function adminEraseUserLearning(
  db: Database,
  env: Env,
  actor: UserRow,
  userId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const target = rows[0];
  if (!target) throw new AppError('not_found');
  if (
    !isSuperadmin(env, actor.email) &&
    (target.role === 'admin' || isSuperadmin(env, target.email))
  ) {
    throw new AppError(
      'forbidden',
      'Akses ditolak. Hanya superadmin yang bisa menghapus materi admin.',
    );
  }
  await eraseLearning(db, target.id);
  await recordAdminAudit(db, {
    actorId: actor.id,
    action: 'learning_erase',
    targetId: target.id,
  });
}

export type AdminAdjustStatus =
  | 'applied'
  | 'duplicate'
  | 'insufficient'
  | 'capped';

export type AdminAdjustOutcome = {
  status: AdminAdjustStatus;
  amount: number;
  balance: number;
  remaining: number;
};

/** Total kredit positif yang sudah diberikan aktor ini dalam 24 jam terakhir. */
export async function adminGrantedLast24h(
  db: Database,
  actorId: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = await db.get<{ total: number | null }>(sql`
    select coalesce(sum(amount), 0) as total
    from credit_ledger
    where ref_id = ${actorId}
      and reason = 'admin_adjust'
      and amount > 0
      and created_at >= ${since}
  `);
  return Number(row?.total ?? 0);
}

export async function adminAdjustLedger(
  db: Database,
  env: Env,
  actor: UserRow,
  userId: string,
  raw: unknown,
): Promise<AdminAdjustOutcome> {
  assertSuperadmin(env, actor);
  const body = adminAdjustSchema.parse(raw);
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows[0]) throw new AppError('not_found');
  const { balanceOf } = await import('../billing/ledger');
  const balance = await balanceOf(db, rows[0].id);
  if (body.amount > 0) {
    const cap = (await loadConfig(db)).adminDailyCreditCap;
    const granted = await adminGrantedLast24h(db, actor.id);
    if (granted + body.amount > cap)
      return {
        status: 'capped',
        amount: body.amount,
        balance,
        remaining: Math.max(0, cap - granted),
      };
  }
  const result = await debitIfEnough(db, {
    userId: rows[0].id,
    amount: body.amount,
    reason: 'admin_adjust',
    refType: 'admin',
    refId: actor.id,
    idempotencyKey: `admin:${body.nonce ?? crypto.randomUUID()}`,
    note: body.note,
    category: body.category ?? null,
  });
  return {
    status:
      result === 'inserted'
        ? 'applied'
        : result === 'duplicate'
          ? 'duplicate'
          : 'insufficient',
    amount: body.amount,
    balance: await balanceOf(db, rows[0].id),
    remaining: 0,
  };
}

export type AdminBulkAdjustOutcome = {
  applied: number;
  duplicate: number;
  insufficient: number;
  missing: number;
  amount: number;
  capped: boolean;
  remaining: number;
};

export async function adminAdjustLedgerBulk(
  db: Database,
  env: Env,
  actor: UserRow,
  raw: unknown,
): Promise<AdminBulkAdjustOutcome> {
  assertSuperadmin(env, actor);
  const body = adminBulkAdjustSchema.parse(raw);
  const ids = [...new Set(body.userIds)];
  let remaining = 0;
  if (body.amount > 0) {
    const cap = (await loadConfig(db)).adminDailyCreditCap;
    const granted = await adminGrantedLast24h(db, actor.id);
    remaining = Math.max(0, cap - granted);
    if (granted + body.amount * ids.length > cap)
      return {
        applied: 0,
        duplicate: 0,
        insufficient: 0,
        missing: 0,
        amount: body.amount,
        capped: true,
        remaining,
      };
  }
  const known = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, ids));
  const knownIds = new Set(known.map((row) => row.id));
  let applied = 0;
  let duplicate = 0;
  let insufficient = 0;
  let missing = 0;
  for (const id of ids) {
    if (!knownIds.has(id)) {
      missing += 1;
      continue;
    }
    const result = await debitIfEnough(db, {
      userId: id,
      amount: body.amount,
      reason: 'admin_adjust',
      refType: 'admin',
      refId: actor.id,
      idempotencyKey: `admin-bulk:${body.nonce ?? crypto.randomUUID()}:${id}`,
      note: body.note,
      category: body.category ?? null,
    });
    if (result === 'inserted') applied += 1;
    else if (result === 'duplicate') duplicate += 1;
    else insufficient += 1;
  }
  return {
    applied,
    duplicate,
    insufficient,
    missing,
    amount: body.amount,
    capped: false,
    remaining,
  };
}

export async function updateAppConfig(
  db: Database,
  env: Env,
  actor: UserRow,
  raw: unknown,
): Promise<void> {
  assertSuperadmin(env, actor);
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'nilai'}: ${issue.message}`)
      .slice(0, 3)
      .join('; ');
    throw new AppError('validation', `Konfigurasi tidak valid (${detail})`);
  }
  await db.update(appConfig).set(parsed.data).where(eq(appConfig.id, 'app'));
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
  const rows = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.task, task))
    .limit(1);
  const current = rows[0];
  if (!current) throw new AppError('not_found');
  const version = current.version + 1;
  const now = nowIso();
  await db.batch([
    db
      .update(promptTemplates)
      .set({ body: body.body, version, updatedAt: now, updatedBy: actor.id })
      .where(eq(promptTemplates.task, task)),
    db.insert(promptVersions).values({
      id: crypto.randomUUID(),
      task,
      version,
      body: body.body,
      createdAt: now,
      createdBy: actor.id,
    }),
  ]);
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
