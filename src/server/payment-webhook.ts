import { and, eq } from 'drizzle-orm';
import { signSvix, verifySvix } from '../billing/webhook';
import { creditLedger, creditOrders, paymentEvents } from '../db/schema';
import { AppError, errorMessage } from '../domain/errors';
import { webhookSchema } from '../domain/schemas';
import { nowIso } from '../domain/time';
import { database } from './account';
import { logEvent } from './log';
import { allowWebhookIp } from './rate';

export async function handlePaymentWebhook(
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

export async function simulateDevPaymentCompletion(
  env: Env,
  request: Request,
  userId: string,
  internalOrderId: string,
): Promise<void> {
  if (env.SUMOPOD_API_KEY !== 'mock') throw new AppError('not_found');
  const db = await database(env);
  const rows = await db
    .select()
    .from(creditOrders)
    .where(
      and(
        eq(creditOrders.id, internalOrderId),
        eq(creditOrders.userId, userId),
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
    env.SUMOPOD_WEBHOOK_SECRET,
    svixId,
    timestamp,
  );
  const headers = new Headers({
    'svix-id': svixId,
    'svix-timestamp': String(timestamp),
    'svix-signature': signature,
  });
  const response = await handlePaymentWebhook(env, payload, headers, request);
  if (response.status >= 400) throw new AppError('validation');
}
