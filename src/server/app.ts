import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';
import {
  aiModels,
  aiProviders,
  appConfig,
  creditPacks,
  generationJobs,
  type UserRow,
  users,
} from '../db/schema';
import {
  AppError,
  type ErrorCode,
  errorMessage,
  errorStatus,
} from '../domain/errors';
import { assertAllowedLlmBaseUrl } from '../domain/provider-url';
import {
  adminAdjustSchema,
  adminUserSchema,
  attemptSchema,
  configSchema,
  devSessionSchema,
  modelSchema,
  packOrderSchema,
  packsSchema,
  promptSchema,
  streakSchema,
  taskSchema,
  topicSchema,
} from '../domain/schemas';
import { nowIso } from '../domain/time';
import { database, ensureUser, eraseLearning, loadConfig } from './account';
import { isSuperadmin } from './admin-access';
import {
  adminUserDetail,
  fetchAdminStats,
  fetchAdminTrend7d,
  getActiveModelForTask,
  getPromptForTask,
  listAdminJobs,
  listAdminLedger,
  listAdminOrders,
  listAdminUsers,
  listAllPacks,
  publicCreditPacks,
} from './admin-data';
import { adminLedgerExportCsv, adminOrdersExportCsv } from './admin-export';
import { readAdminQuery } from './admin-list';
import { adminAdjustLedger, updatePromptTemplate } from './admin-mutations';
import { DEV_COOKIE, devIdentityFor, identify, signDevSession } from './auth';
import {
  createCreditPackOrder,
  fetchUserCreditOrder,
  simulateDevPaymentCompletion,
} from './credit-orders-service';
import { creditsPayload, readCreditsQuery } from './credits-page';
import { cookieHeader } from './crypto';
import {
  CSRF_HEADER,
  isCrossSiteMutation,
  verifyCsrfDoubleSubmit,
} from './csrf';
import {
  openLesson,
  startQuiz,
  startRoadmap,
  suggestChapterLesson,
} from './generation';
import { ledgerExportCsv } from './ledger-enrich';
import { completeLesson } from './lesson-actions';
import { logEvent } from './log';
import { saveOutline } from './outline-save';
import { ownedLesson } from './owned';
import { activateUserPath } from './path-actions';
import { handlePaymentWebhook } from './payment-webhook';
import { submitQuizAttempt } from './quiz-actions';
import { lessonContent, library, mePayload, pathDetail } from './read';
import { devRoutesEnabled } from './runtime';
import { isSecure } from './security';

function assertSuperadmin(c: { env: Env; get: (key: 'user') => UserRow }) {
  if (!isSuperadmin(c.env, c.get('user').email))
    throw new AppError('forbidden');
}

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

  app.onError((error, c) => {
    if (error instanceof AppError)
      return jsonError(c, error.code, error.message);
    logEvent({ message: 'request_failed' });
    return jsonError(c, 'validation', errorMessage.validation, 500);
  });

  app.use('/api/dev/*', async (c, next) => {
    if (!devRoutesEnabled(c.env)) throw new AppError('not_found');
    await next();
  });

  app.use('/api/*', async (c, next) => {
    if (
      c.req.method === 'GET' ||
      c.req.method === 'HEAD' ||
      c.req.path === '/api/webhooks/sumopod'
    )
      return next();
    if (isCrossSiteMutation(c.req.raw)) return jsonError(c, 'forbidden');
    const cookieHeader = c.req.header('cookie');
    if (
      !verifyCsrfDoubleSubmit(
        cookieHeader ?? null,
        c.req.header(CSRF_HEADER) ?? null,
      )
    )
      return jsonError(c, 'forbidden');
    await next();
  });

  app.post('/api/dev/session', async (c) => {
    if (c.env.CLERK_SECRET_KEY !== 'mock') throw new AppError('not_found');
    const body = await readJson(c, devSessionSchema);
    const identity = await devIdentityFor(body.email, body.name);
    const db = await database(c.env);
    await ensureUser(db, c.env, identity);
    const token = await signDevSession(identity, c.env.CLERK_SECRET_KEY);
    c.header(
      'set-cookie',
      cookieHeader(DEV_COOKIE, token, {
        httpOnly: true,
        secure: isSecure(c.req.raw),
        maxAge: 7 * 24 * 60 * 60,
      }),
      { append: true },
    );
    return c.json({ ok: true });
  });

  app.post('/api/session/logout', async (c) => {
    c.header(
      'set-cookie',
      cookieHeader(DEV_COOKIE, '', {
        httpOnly: true,
        secure: isSecure(c.req.raw),
        maxAge: 0,
      }),
      { append: true },
    );
    return c.json({ ok: true });
  });

  app.use('/api/*', async (c, next) => {
    if (
      c.req.path.startsWith('/api/webhooks/') ||
      c.req.path === '/api/dev/session' ||
      c.req.path === '/api/session/logout'
    )
      return next();
    const identity = await identify(c.req.raw, c.env);
    if (!identity) return jsonError(c, 'forbidden');
    const db = await database(c.env);
    c.set('user', await ensureUser(db, c.env, identity));
    await next();
  });

  app.get('/api/me', async (c) =>
    c.json(await mePayload(await database(c.env), c.get('user'))),
  );
  app.get('/api/paths', async (c) =>
    c.json({ paths: await library(await database(c.env), c.get('user').id) }),
  );

  app.post('/api/paths', async (c) => {
    const body = await readJson(c, topicSchema);
    const started = await startRoadmap(
      c.env,
      c.req.raw,
      c.get('user'),
      body.topic,
    );
    return c.json(started, 202);
  });

  app.get('/api/paths/:id', async (c) => {
    const detail = await pathDetail(
      await database(c.env),
      c.get('user').id,
      c.req.param('id'),
    );
    if (!detail) throw new AppError('not_found');
    return c.json(detail);
  });

  app.patch('/api/paths/:id', async (c) => {
    const body = await c.req.json().catch(() => {
      throw new AppError('validation');
    });
    await saveOutline(
      await database(c.env),
      c.get('user').id,
      c.req.param('id'),
      body,
    );
    return c.json({ ok: true });
  });

  app.post('/api/paths/:id/active', async (c) => {
    await activateUserPath(
      await database(c.env),
      c.get('user').id,
      c.req.param('id'),
    );
    return c.json({ ok: true });
  });

  app.get('/api/lessons/:id', async (c) => {
    const db = await database(c.env);
    const detail = await ownedLesson(db, c.get('user').id, c.req.param('id'));
    if (!detail) throw new AppError('not_found');
    return c.json(await lessonContent(db, detail.id));
  });

  app.post('/api/lessons/:id/open', async (c) => {
    const opened = await openLesson(
      c.env,
      c.req.raw,
      c.get('user'),
      c.req.param('id'),
    );
    if (opened.ready) {
      const content = await lessonContent(
        await database(c.env),
        opened.lessonId,
      );
      return c.json(content);
    }
    return c.json(opened, 202);
  });

  app.post('/api/lessons/:id/complete', async (c) =>
    c.json(
      await completeLesson(
        await database(c.env),
        c.get('user'),
        c.req.param('id'),
      ),
    ),
  );

  app.post('/api/chapters/:id/quiz', async (c) => {
    const started = await startQuiz(
      c.env,
      c.req.raw,
      c.get('user'),
      c.req.param('id'),
    );
    return c.json(started, 202);
  });

  app.post('/api/chapters/:id/lessons/ai', async (c) => {
    const created = await suggestChapterLesson(
      c.env,
      c.req.raw,
      c.get('user'),
      c.req.param('id'),
    );
    return c.json(created);
  });

  app.post('/api/quizzes/:id/attempts', async (c) => {
    const body = await readJson(c, attemptSchema);
    return c.json(
      await submitQuizAttempt(
        await database(c.env),
        c.get('user'),
        c.req.param('id'),
        body.answers,
      ),
    );
  });

  app.get('/api/jobs/:id', async (c) => {
    const db = await database(c.env);
    const rows = await db
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.id, c.req.param('id')),
          eq(generationJobs.userId, c.get('user').id),
        ),
      )
      .limit(1);
    const job = rows[0];
    if (!job) throw new AppError('not_found');
    return c.json({
      id: job.id,
      kind: job.kind,
      status: job.status,
      errorCode: job.errorCode,
      refId: job.refId,
    });
  });

  app.get('/api/credits', async (c) => {
    const db = await database(c.env);
    return c.json(await creditsPayload(db, c.get('user'), c.req.url));
  });

  app.get('/api/credits/ledger/export', async (c) => {
    const query = readCreditsQuery(c.req.url);
    const db = await database(c.env);
    const user = c.get('user');
    const csv = await ledgerExportCsv(db, user.id, query.reason || undefined);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="buku-besar-otodidak.csv"',
      },
    });
  });

  app.get('/api/credit-packs', async (c) =>
    c.json({ packs: await publicCreditPacks(await database(c.env)) }),
  );

  app.post('/api/credit-orders', async (c) => {
    const body = await readJson(c, packOrderSchema);
    const db = await database(c.env);
    return c.json(
      await createCreditPackOrder(
        c.env,
        c.req.raw,
        db,
        c.get('user'),
        body.packId,
      ),
    );
  });

  app.get('/api/credit-orders/:id', async (c) =>
    c.json(
      await fetchUserCreditOrder(
        await database(c.env),
        c.get('user').id,
        c.req.param('id'),
        c.env,
      ),
    ),
  );

  app.post('/api/dev/payments/:id/complete', async (c) => {
    await simulateDevPaymentCompletion(
      c.env,
      c.req.raw,
      c.get('user').id,
      c.req.param('id'),
    );
    return c.json({ ok: true });
  });

  app.post('/api/webhooks/sumopod', async (c) => {
    const raw = await c.req.text();
    return handlePaymentWebhook(c.env, raw, c.req.raw.headers, c.req.raw);
  });

  app.post('/api/profile/streak', async (c) => {
    const body = await readJson(c, streakSchema);
    await (await database(c.env))
      .update(users)
      .set({ streakEnabled: body.enabled ? 1 : 0, updatedAt: nowIso() })
      .where(eq(users.id, c.get('user').id));
    return c.json({ enabled: body.enabled });
  });

  app.post('/api/profile/deletion-request', async (c) => {
    const when = nowIso();
    await (await database(c.env))
      .update(users)
      .set({ deletionRequestedAt: when, updatedAt: when })
      .where(eq(users.id, c.get('user').id));
    return c.json({ deletionRequestedAt: when });
  });

  app.use('/api/admin/*', async (c, next) => {
    if (c.get('user').role !== 'admin') return jsonError(c, 'forbidden');
    await next();
  });

  app.get('/api/admin/stats', async (c) =>
    c.json(await fetchAdminStats(await database(c.env))),
  );

  app.get('/api/admin/trend7d', async (c) =>
    c.json(await fetchAdminTrend7d(await database(c.env))),
  );

  app.get('/api/admin/users', async (c) =>
    c.json(await listAdminUsers(await database(c.env), c.req.url)),
  );

  app.get('/api/admin/users/:id', async (c) =>
    c.json(await adminUserDetail(await database(c.env), c.req.param('id'))),
  );

  app.patch('/api/admin/users/:id', async (c) => {
    const body = await readJson(c, adminUserSchema);
    const db = await database(c.env);
    const actor = c.get('user');
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, c.req.param('id')))
      .limit(1);
    const target = rows[0];
    if (!target) throw new AppError('not_found');
    if (
      body.role === 'admin' &&
      target.role !== 'admin' &&
      !isSuperadmin(c.env, actor.email)
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
    return c.json({ ok: true });
  });

  app.post('/api/admin/users/:id/deletion', async (c) => {
    const db = await database(c.env);
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, c.req.param('id')))
      .limit(1);
    if (!rows[0]) throw new AppError('not_found');
    await eraseLearning(db, rows[0].id);
    return c.json({ ok: true });
  });

  app.get('/api/admin/ledger', async (c) =>
    c.json(await listAdminLedger(await database(c.env), c.req.url)),
  );

  app.get('/api/admin/orders', async (c) =>
    c.json(await listAdminOrders(await database(c.env), c.req.url)),
  );

  app.get('/api/admin/ledger/export', async (c) => {
    const query = readAdminQuery(c.req.url);
    const db = await database(c.env);
    const csv = await adminLedgerExportCsv(db, query);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition':
          'attachment; filename="admin-buku-besar-otodidak.csv"',
      },
    });
  });

  app.get('/api/admin/orders/export', async (c) => {
    const query = readAdminQuery(c.req.url);
    const db = await database(c.env);
    const csv = await adminOrdersExportCsv(db, query);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition':
          'attachment; filename="admin-pesanan-otodidak.csv"',
      },
    });
  });

  app.get('/api/admin/jobs', async (c) =>
    c.json(await listAdminJobs(await database(c.env), c.req.url)),
  );

  app.post('/api/admin/users/:id/ledger', async (c) => {
    assertSuperadmin(c);
    const body = await readJson(c, adminAdjustSchema);
    const db = await database(c.env);
    const outcome = await adminAdjustLedger(
      db,
      c.env,
      c.get('user'),
      c.req.param('id'),
      body,
    );
    if (outcome.status === 'insufficient')
      throw new AppError('insufficient_credits');
    if (outcome.status === 'capped') throw new AppError('rate_limited');
    return c.json({
      ok: true,
      status: outcome.status,
      balance: outcome.balance,
    });
  });

  app.get('/api/admin/config', async (c) =>
    c.json(await loadConfig(await database(c.env))),
  );
  app.put('/api/admin/config', async (c) => {
    assertSuperadmin(c);
    const body = await readJson(c, configSchema);
    await (await database(c.env))
      .update(appConfig)
      .set(body)
      .where(eq(appConfig.id, 'app'));
    return c.json({ ok: true });
  });

  app.get('/api/admin/prompts/:task', async (c) => {
    assertSuperadmin(c);
    const task = readTask(c.req.param('task'));
    return c.json(await getPromptForTask(await database(c.env), task));
  });

  app.put('/api/admin/prompts/:task', async (c) => {
    assertSuperadmin(c);
    const task = readTask(c.req.param('task'));
    const body = await readJson(c, promptSchema);
    await updatePromptTemplate(
      await database(c.env),
      c.env,
      c.get('user'),
      task,
      body,
    );
    return c.json({ ok: true });
  });

  app.get('/api/admin/models/:task', async (c) => {
    assertSuperadmin(c);
    const task = readTask(c.req.param('task'));
    return c.json(await getActiveModelForTask(await database(c.env), task));
  });

  app.put('/api/admin/models/:task', async (c) => {
    assertSuperadmin(c);
    const task = readTask(c.req.param('task'));
    const body = await readJson(c, modelSchema);
    if (
      body.authKind !== 'workers_ai_binding' &&
      body.secretName &&
      !knownSecret(c.env, body.secretName)
    ) {
      throw new AppError(
        'validation',
        'Nama secret tidak ada di lingkungan Worker.',
      );
    }
    const db = await database(c.env);
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
    return c.json({ ok: true });
  });

  app.get('/api/admin/packs', async (c) => {
    assertSuperadmin(c);
    return c.json({
      packs: await listAllPacks(await database(c.env)),
    });
  });

  app.put('/api/admin/packs', async (c) => {
    assertSuperadmin(c);
    const body = await readJson(c, packsSchema);
    const db = await database(c.env);
    const rows = await db.select().from(creditPacks);
    const activeById = new Map(rows.map((row) => [row.id, row.active === 1]));
    for (const pack of body.packs) {
      if (pack.credits < 1 || pack.priceIdr < 1)
        throw new AppError('validation', 'Kredit dan harga harus positif.');
      const id = pack.id ?? `pack_${crypto.randomUUID()}`;
      activeById.set(id, pack.active);
    }
    let activeTotal = 0;
    for (const on of activeById.values()) if (on) activeTotal += 1;
    if (activeTotal < 1)
      throw new AppError(
        'validation',
        'Minimal satu paket kredit harus aktif.',
      );
    for (const pack of body.packs) {
      const id = pack.id ?? `pack_${crypto.randomUUID()}`;
      const values = {
        name: pack.name,
        credits: pack.credits,
        priceIdr: pack.priceIdr,
        active: pack.active ? 1 : 0,
        sort: pack.sort,
      };
      const existing = await db
        .select({ id: creditPacks.id })
        .from(creditPacks)
        .where(eq(creditPacks.id, id))
        .limit(1);
      if (existing[0])
        await db.update(creditPacks).set(values).where(eq(creditPacks.id, id));
      else await db.insert(creditPacks).values({ id, ...values });
    }
    return c.json({ ok: true });
  });

  return app;
}

function readTask(value: string) {
  const parsed = taskSchema.safeParse(value);
  if (!parsed.success) throw new AppError('not_found');
  return parsed.data;
}

function jsonError(
  c: { json: (body: unknown, status?: number) => Response },
  code: ErrorCode,
  message = errorMessage[code],
  status = errorStatus[code],
) {
  return c.json({ error: { code, message } }, status);
}

async function readJson<T>(
  c: { req: { json: () => Promise<unknown> } },
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError('validation');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new AppError(
      'validation',
      parsed.error.issues[0]?.message ?? errorMessage.validation,
    );
  return parsed.data;
}

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
