import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';
import { debitIfEnough } from '../billing/ledger';
import { createQrisPayment } from '../billing/sumopod';
import { signSvix, verifySvix } from '../billing/webhook';
import {
  aiModels,
  aiProviders,
  appConfig,
  chapters,
  creditLedger,
  creditOrders,
  creditPacks,
  generationJobs,
  lessons,
  paths,
  paymentEvents,
  promptTemplates,
  quizAttempts,
  quizQuestions,
  quizzes,
  type UserRow,
  users,
} from '../db/schema';
import {
  AppError,
  type ErrorCode,
  errorMessage,
  errorStatus,
} from '../domain/errors';
import {
  adminAdjustSchema,
  adminUserSchema,
  attemptSchema,
  configSchema,
  devSessionSchema,
  modelSchema,
  packOrderSchema,
  packsSchema,
  pageSchema,
  promptSchema,
  streakSchema,
  taskSchema,
  topicSchema,
  webhookSchema,
} from '../domain/schemas';
import { applyStreak } from '../domain/streak';
import { jakartaDate, nowIso } from '../domain/time';
import {
  activePacks,
  balanceOf,
  database,
  ensureUser,
  eraseLearning,
  ledgerPage,
  loadConfig,
  ordersFor,
} from './account';
import { DEV_COOKIE, devIdentityFor, identify, signDevSession } from './auth';
import { cookieHeader, readCookie, timingSafeEqual } from './crypto';
import { openLesson, startQuiz, startRoadmap } from './generation';
import { logEvent } from './log';
import { saveOutline } from './outline-save';
import { allowWebhookIp } from './rate';
import { lessonContent, library, mePayload, pathDetail } from './read';
import { isSecure } from './security';

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

  app.onError((error, c) => {
    if (error instanceof AppError)
      return jsonError(c, error.code, error.message);
    logEvent({ message: 'request_failed' });
    return jsonError(c, 'validation', errorMessage.validation, 500);
  });

  app.use('/api/*', async (c, next) => {
    if (
      c.req.method === 'GET' ||
      c.req.method === 'HEAD' ||
      c.req.path === '/api/webhooks/sumopod'
    )
      return next();
    const cookie = readCookie(c.req.header('cookie') ?? null, 'otodidak_csrf');
    const header = c.req.header('x-csrf-token');
    if (!cookie || !header || !timingSafeEqual(cookie, header))
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
    const db = await database(c.env);
    const user = c.get('user');
    const rows = await db
      .select()
      .from(paths)
      .where(
        and(
          eq(paths.id, c.req.param('id')),
          eq(paths.userId, user.id),
          eq(paths.status, 'ready'),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new AppError('not_found');
    await db.batch([
      db.update(paths).set({ isActive: 0 }).where(eq(paths.userId, user.id)),
      db
        .update(paths)
        .set({ isActive: 1, updatedAt: nowIso() })
        .where(eq(paths.id, rows[0].id)),
    ]);
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

  app.post('/api/lessons/:id/complete', async (c) => {
    const db = await database(c.env);
    const user = c.get('user');
    const detail = await ownedLesson(db, user.id, c.req.param('id'));
    if (!detail) throw new AppError('not_found');
    if (detail.status !== 'ready' || !detail.body)
      throw new AppError('validation', 'Pelajaran belum siap.');
    if (detail.completedAt)
      return c.json({
        completedAt: detail.completedAt,
        streakCount: user.streakCount,
      });
    const today = jakartaDate(new Date());
    const streak = applyStreak(
      {
        enabled: user.streakEnabled === 1,
        count: user.streakCount,
        lastDate: user.streakLastDate,
        freezeWeek: user.streakFreezeWeek,
      },
      today,
    );
    const completedAt = nowIso();
    await db
      .update(lessons)
      .set({ completedAt })
      .where(eq(lessons.id, detail.id));
    if (streak.changed) {
      await db
        .update(users)
        .set({
          streakCount: streak.count,
          streakLastDate: streak.lastDate,
          streakFreezeWeek: streak.freezeWeek,
          updatedAt: completedAt,
        })
        .where(eq(users.id, user.id));
    }
    return c.json({
      completedAt,
      streakCount: streak.count,
      freezeUsedNow: streak.freezeUsedNow,
      restarted: streak.restarted,
    });
  });

  app.post('/api/chapters/:id/quiz', async (c) => {
    const started = await startQuiz(
      c.env,
      c.req.raw,
      c.get('user'),
      c.req.param('id'),
    );
    return c.json(started, 202);
  });

  app.post('/api/quizzes/:id/attempts', async (c) => {
    const body = await readJson(c, attemptSchema);
    const db = await database(c.env);
    const user = c.get('user');
    const quizRows = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, c.req.param('id')))
      .limit(1);
    const quiz = quizRows[0];
    if (!quiz) throw new AppError('not_found');
    const chapterRows = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, quiz.chapterId))
      .limit(1);
    const chapter = chapterRows[0];
    if (!chapter) throw new AppError('not_found');
    const pathRows = await db
      .select()
      .from(paths)
      .where(and(eq(paths.id, chapter.pathId), eq(paths.userId, user.id)))
      .limit(1);
    if (!pathRows[0]) throw new AppError('not_found');
    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quiz.id))
      .orderBy(asc(quizQuestions.position));
    if (body.answers.length !== questions.length)
      throw new AppError('validation', 'Jumlah jawaban tidak sesuai.');
    let correct = 0;
    const review = questions.map((question, index) => {
      const selected = body.answers[index] ?? 0;
      const right = selected === question.correctIndex;
      if (right) correct += 1;
      return {
        id: question.id,
        stem: question.stem,
        choices: parseChoices(question.choicesJson),
        selected,
        correctIndex: question.correctIndex,
        explanation: right ? null : question.explanation,
      };
    });
    const scorePercent = Math.round((correct / questions.length) * 100);
    const config = await loadConfig(db);
    const quizStatus =
      scorePercent >= config.quizPassPercent ? 'understood' : 'retry';
    await db.insert(quizAttempts).values({
      id: crypto.randomUUID(),
      quizId: quiz.id,
      userId: user.id,
      scorePercent,
      answersJson: JSON.stringify(body.answers),
      createdAt: nowIso(),
    });
    await db
      .update(chapters)
      .set({ quizStatus })
      .where(eq(chapters.id, chapter.id));
    return c.json({ scorePercent, quizStatus, review });
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
    const query = readQuery(c.req.url);
    const db = await database(c.env);
    const user = c.get('user');
    return c.json({
      balance: await balanceOf(db, user.id),
      entries: await ledgerPage(db, user.id, query.limit, query.offset),
      orders: await ordersFor(db, user.id),
    });
  });

  app.get('/api/credit-packs', async (c) =>
    c.json({ packs: await activePacks(await database(c.env)) }),
  );

  app.post('/api/credit-orders', async (c) => {
    const body = await readJson(c, packOrderSchema);
    const db = await database(c.env);
    const user = c.get('user');
    if (user.status === 'suspended') throw new AppError('account_suspended');
    const packs = await db
      .select()
      .from(creditPacks)
      .where(and(eq(creditPacks.id, body.packId), eq(creditPacks.active, 1)))
      .limit(1);
    const pack = packs[0];
    if (!pack) throw new AppError('not_found');
    const id = crypto.randomUUID();
    const orderId = `ord_${id.replaceAll('-', '')}`;
    await db
      .update(creditOrders)
      .set({ status: 'expired' })
      .where(
        and(
          eq(creditOrders.userId, user.id),
          eq(creditOrders.status, 'pending'),
        ),
      );
    await db.insert(creditOrders).values({
      id,
      userId: user.id,
      packId: pack.id,
      orderId,
      amountIdr: pack.priceIdr,
      credits: pack.credits,
      status: 'pending',
      sumopodPaymentId: null,
      paymentLinkUrl: null,
      createdAt: nowIso(),
      paidAt: null,
    });
    const returnUrl = `${c.env.APP_ORIGIN}/kredit/pesanan/${id}`;
    try {
      const payment = await createQrisPayment({
        apiKey: c.env.SUMOPOD_API_KEY,
        baseUrl: c.env.SUMOPOD_API_BASE,
        orderId,
        amount: pack.priceIdr,
        returnUrl,
      });
      await db
        .update(creditOrders)
        .set({
          sumopodPaymentId: payment.paymentId,
          paymentLinkUrl: payment.paymentLinkUrl,
        })
        .where(eq(creditOrders.id, id));
      return c.json({
        id,
        orderId,
        paymentLinkUrl: payment.paymentLinkUrl,
        paymentCode: payment.paymentCode,
        mock: c.env.SUMOPOD_API_KEY === 'mock',
      });
    } catch {
      await db
        .update(creditOrders)
        .set({ status: 'failed' })
        .where(eq(creditOrders.id, id));
      logEvent({
        message: 'payment_create_failed',
        userId: user.id,
        errorCode: 'validation',
      });
      throw new AppError(
        'validation',
        'Pembayaran belum bisa dibuat. Coba lagi sebentar.',
      );
    }
  });

  app.get('/api/credit-orders/:id', async (c) => {
    const db = await database(c.env);
    const rows = await db
      .select()
      .from(creditOrders)
      .where(
        and(
          eq(creditOrders.id, c.req.param('id')),
          eq(creditOrders.userId, c.get('user').id),
        ),
      )
      .limit(1);
    const order = rows[0];
    if (!order) throw new AppError('not_found');
    return c.json({
      ...publicOrder(order),
      mock: c.env.SUMOPOD_API_KEY === 'mock',
    });
  });

  app.post('/api/dev/payments/:id/complete', async (c) => {
    if (c.env.SUMOPOD_API_KEY !== 'mock') throw new AppError('not_found');
    const db = await database(c.env);
    const rows = await db
      .select()
      .from(creditOrders)
      .where(
        and(
          eq(creditOrders.id, c.req.param('id')),
          eq(creditOrders.userId, c.get('user').id),
        ),
      )
      .limit(1);
    const order = rows[0];
    if (!order) throw new AppError('not_found');
    const payload = JSON.stringify({
      event_type: 'payment.completed',
      data: {
        payment_id: order.sumopodPaymentId ?? `pay_${order.orderId}`,
        order_id: order.orderId,
        amount: order.amountIdr,
        status: 'completed',
      },
    });
    const svixId = `dev_${crypto.randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signSvix(
      payload,
      c.env.SUMOPOD_WEBHOOK_SECRET,
      svixId,
      timestamp,
    );
    const headers = new Headers({
      'svix-id': svixId,
      'svix-timestamp': String(timestamp),
      'svix-signature': signature,
    });
    return handleWebhook(c.env, payload, headers, c.req.raw);
  });

  app.post('/api/webhooks/sumopod', async (c) => {
    const raw = await c.req.text();
    return handleWebhook(c.env, raw, c.req.raw.headers, c.req.raw);
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

  app.get('/api/admin/users', async (c) => {
    const query = readQuery(c.req.url);
    const db = await database(c.env);
    const filters = query.email ? eq(users.email, query.email) : undefined;
    const rows = await db
      .select()
      .from(users)
      .where(filters)
      .orderBy(desc(users.createdAt))
      .limit(query.limit)
      .offset(query.offset);
    const list = [];
    for (const user of rows)
      list.push({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        balance: await balanceOf(db, user.id),
        deletionRequestedAt: user.deletionRequestedAt,
      });
    return c.json({ users: list });
  });

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

  app.get('/api/admin/ledger', async (c) => {
    const query = readQuery(c.req.url);
    const db = await database(c.env);
    const filters = query.userId
      ? eq(creditLedger.userId, query.userId)
      : undefined;
    const entries = await db
      .select()
      .from(creditLedger)
      .where(filters)
      .orderBy(desc(creditLedger.createdAt))
      .limit(query.limit)
      .offset(query.offset);
    return c.json({ entries });
  });

  app.post('/api/admin/users/:id/ledger', async (c) => {
    const body = await readJson(c, adminAdjustSchema);
    const db = await database(c.env);
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, c.req.param('id')))
      .limit(1);
    if (!rows[0]) throw new AppError('not_found');
    const result = await debitIfEnough(db, {
      userId: rows[0].id,
      amount: body.amount,
      reason: 'admin_adjust',
      refType: 'admin',
      refId: c.get('user').id,
      idempotencyKey: `admin:${crypto.randomUUID()}`,
      note: body.note,
    });
    if (result !== 'inserted') throw new AppError('insufficient_credits');
    return c.json({ ok: true, balance: await balanceOf(db, rows[0].id) });
  });

  app.get('/api/admin/config', async (c) =>
    c.json(await loadConfig(await database(c.env))),
  );
  app.put('/api/admin/config', async (c) => {
    const body = await readJson(c, configSchema);
    await (await database(c.env))
      .update(appConfig)
      .set(body)
      .where(eq(appConfig.id, 'app'));
    return c.json({ ok: true });
  });

  app.get('/api/admin/prompts/:task', async (c) => {
    const task = readTask(c.req.param('task'));
    const rows = await (await database(c.env))
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.task, task))
      .limit(1);
    if (!rows[0]) throw new AppError('not_found');
    return c.json(rows[0]);
  });

  app.put('/api/admin/prompts/:task', async (c) => {
    const task = readTask(c.req.param('task'));
    const body = await readJson(c, promptSchema);
    await (await database(c.env))
      .update(promptTemplates)
      .set({
        body: body.body,
        updatedAt: nowIso(),
        updatedBy: c.get('user').id,
      })
      .where(eq(promptTemplates.task, task));
    return c.json({ ok: true });
  });

  app.get('/api/admin/models/:task', async (c) => {
    const task = readTask(c.req.param('task'));
    const db = await database(c.env);
    const rows = await db
      .select({
        modelName: aiModels.modelName,
        maxOutputTokens: aiModels.maxOutputTokens,
        timeoutMs: aiModels.timeoutMs,
        baseUrl: aiProviders.baseUrl,
        secretName: aiProviders.secretName,
        authKind: aiProviders.authKind,
      })
      .from(aiModels)
      .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
      .where(and(eq(aiModels.task, task), eq(aiModels.active, 1)))
      .limit(1);
    if (!rows[0]) throw new AppError('not_found');
    return c.json(rows[0]);
  });

  app.put('/api/admin/models/:task', async (c) => {
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
          baseUrl: body.baseUrl ?? provider.baseUrl,
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

  app.get('/api/admin/packs', async (c) =>
    c.json({
      packs: await (await database(c.env))
        .select()
        .from(creditPacks)
        .orderBy(asc(creditPacks.sort)),
    }),
  );

  app.put('/api/admin/packs', async (c) => {
    const body = await readJson(c, packsSchema);
    const db = await database(c.env);
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

async function handleWebhook(
  env: Env,
  raw: string,
  headers: Headers,
  request: Request,
): Promise<Response> {
  if (!(await allowWebhookIp(env.APP_KV, request))) {
    return Response.json(
      { error: { code: 'rate_limited', message: errorMessage.rate_limited } },
      { status: 429 },
    );
  }
  const verified = await verifySvix(raw, headers, env.SUMOPOD_WEBHOOK_SECRET);
  if (!verified)
    return Response.json(
      { error: { code: 'forbidden', message: errorMessage.forbidden } },
      { status: 401 },
    );
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return Response.json(
      { error: { code: 'validation', message: errorMessage.validation } },
      { status: 400 },
    );
  }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success)
    return Response.json(
      { error: { code: 'validation', message: errorMessage.validation } },
      { status: 400 },
    );
  const svixId = headers.get('svix-id');
  if (!svixId)
    return Response.json(
      { error: { code: 'forbidden', message: errorMessage.forbidden } },
      { status: 401 },
    );
  const db = await database(env);
  const seen = await db
    .select()
    .from(paymentEvents)
    .where(eq(paymentEvents.svixId, svixId))
    .limit(1);
  if (seen[0]) return Response.json({ ok: true });
  const event = parsed.data;
  const orders = await db
    .select()
    .from(creditOrders)
    .where(eq(creditOrders.orderId, event.data.order_id))
    .limit(1);
  const order = orders[0];
  const createdAt = nowIso();
  if (order?.status !== 'pending') {
    await db
      .insert(paymentEvents)
      .values({
        svixId,
        orderId: event.data.order_id,
        eventType: event.event_type,
        paymentId: event.data.payment_id,
        createdAt,
      })
      .onConflictDoNothing();
    if (!order)
      logEvent({ message: 'webhook_unknown_order', errorCode: 'not_found' });
    return Response.json({ ok: true });
  }
  if (
    event.event_type === 'payment.completed' &&
    event.data.amount !== order.amountIdr
  ) {
    await db.insert(paymentEvents).values({
      svixId,
      orderId: order.orderId,
      eventType: event.event_type,
      paymentId: event.data.payment_id,
      createdAt,
    });
    await db
      .update(creditOrders)
      .set({ status: 'failed' })
      .where(
        and(eq(creditOrders.id, order.id), eq(creditOrders.status, 'pending')),
      );
    logEvent({
      message: 'webhook_amount_mismatch',
      errorCode: 'validation',
      userId: order.userId,
    });
    return Response.json({ ok: true });
  }
  if (event.event_type === 'payment.completed') {
    try {
      await db.batch([
        db.insert(paymentEvents).values({
          svixId,
          orderId: order.orderId,
          eventType: event.event_type,
          paymentId: event.data.payment_id,
          createdAt,
        }),
        db
          .update(creditOrders)
          .set({
            status: 'paid',
            paidAt: createdAt,
            sumopodPaymentId: event.data.payment_id,
          })
          .where(
            and(
              eq(creditOrders.id, order.id),
              eq(creditOrders.status, 'pending'),
            ),
          ),
        db.insert(creditLedger).values({
          id: crypto.randomUUID(),
          userId: order.userId,
          amount: order.credits,
          reason: 'purchase',
          refType: 'order',
          refId: order.id,
          idempotencyKey: `purchase:${event.data.payment_id}`,
          note: null,
          createdAt,
        }),
      ]);
    } catch {
      return Response.json({ ok: true });
    }
    logEvent({
      message: 'payment_completed',
      userId: order.userId,
      status: 'paid',
    });
    return Response.json({ ok: true });
  }
  const status = event.event_type === 'payment.expired' ? 'expired' : 'failed';
  await db
    .insert(paymentEvents)
    .values({
      svixId,
      orderId: order.orderId,
      eventType: event.event_type,
      paymentId: event.data.payment_id,
      createdAt,
    })
    .onConflictDoNothing();
  await db
    .update(creditOrders)
    .set({ status })
    .where(
      and(eq(creditOrders.id, order.id), eq(creditOrders.status, 'pending')),
    );
  return Response.json({ ok: true });
}

function readQuery(url: string) {
  const parsed = pageSchema.safeParse(
    Object.fromEntries(new URL(url).searchParams),
  );
  if (!parsed.success) throw new AppError('validation');
  return parsed.data;
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

async function ownedLesson(
  db: Awaited<ReturnType<typeof database>>,
  userId: string,
  lessonId: string,
) {
  const lessonRows = await db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  const lesson = lessonRows[0];
  if (!lesson) return null;
  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, lesson.chapterId))
    .limit(1);
  const chapter = chapterRows[0];
  if (!chapter) return null;
  const pathRows = await db
    .select()
    .from(paths)
    .where(and(eq(paths.id, chapter.pathId), eq(paths.userId, userId)))
    .limit(1);
  if (!pathRows[0]) return null;
  return lesson;
}

function publicOrder(order: typeof creditOrders.$inferSelect) {
  return {
    id: order.id,
    orderId: order.orderId,
    amountIdr: order.amountIdr,
    credits: order.credits,
    status: order.status,
    paymentLinkUrl: order.paymentLinkUrl,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}

function parseChoices(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    )
      return parsed;
  } catch {
    return [];
  }
  return [];
}

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
