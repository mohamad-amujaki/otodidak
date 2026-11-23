import { and, eq } from 'drizzle-orm';
import { readHostedPayment } from '../billing/hosted-payment';
import {
  createQrisPayment,
  isSandboxPaymentUrl,
  sumopodApiBase,
} from '../billing/sumopod';
import type { Database } from '../db/client';
import { creditOrders, creditPacks, type UserRow } from '../db/schema';
import { AppError } from '../domain/errors';
import { nowIso } from '../domain/time';
import { logEvent } from './log';
import { requestAppOrigin } from './origin';
import { grantPurchase, simulateDevPaymentCompletion } from './payment-webhook';

export function publicCreditOrder(order: typeof creditOrders.$inferSelect) {
  return {
    id: order.id,
    orderId: order.orderId,
    amountIdr: order.amountIdr,
    credits: order.credits,
    status: order.status,
    paymentLinkUrl: order.paymentLinkUrl,
    paymentCode: order.paymentCode,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}

export async function createCreditPackOrder(
  env: Env,
  request: Request,
  db: Database,
  user: UserRow,
  packId: string,
) {
  if (user.status === 'suspended') throw new AppError('account_suspended');
  const packs = await db
    .select()
    .from(creditPacks)
    .where(and(eq(creditPacks.id, packId), eq(creditPacks.active, 1)))
    .limit(1);
  const pack = packs[0];
  if (!pack) throw new AppError('not_found');
  const id = crypto.randomUUID();
  const orderId = `ord_${id.replaceAll('-', '')}`;
  await db
    .update(creditOrders)
    .set({ status: 'expired' })
    .where(
      and(eq(creditOrders.userId, user.id), eq(creditOrders.status, 'pending')),
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
  const origin = requestAppOrigin(request, env);
  const returnUrl = `${origin}/kredit/pesanan/${id}`;
  const qrPageUrl = `${origin}/kredit/pesanan/${id}/qris`;
  try {
    const payment = await createQrisPayment({
      apiKey: env.SUMOPOD_API_KEY,
      baseUrl: sumopodApiBase(env.ENVIRONMENT, env.SUMOPOD_API_BASE),
      orderId,
      amount: pack.priceIdr,
      returnUrl,
      qrPageUrl,
    });
    if (
      env.ENVIRONMENT === 'production' &&
      isSandboxPaymentUrl(payment.paymentLinkUrl)
    ) {
      throw new Error('sandbox_payment_in_production');
    }
    const paymentLinkUrl = payment.paymentCode
      ? qrPageUrl
      : payment.paymentLinkUrl;
    await db
      .update(creditOrders)
      .set({
        sumopodPaymentId: payment.paymentId,
        paymentLinkUrl,
        paymentCode: payment.paymentCode,
      })
      .where(eq(creditOrders.id, id));
    return {
      id,
      orderId,
      paymentLinkUrl,
      paymentCode: payment.paymentCode,
      mock: env.SUMOPOD_API_KEY === 'mock',
    };
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
}

export async function fetchUserCreditOrder(
  db: Database,
  userId: string,
  internalId: string,
  env: Env,
) {
  const rows = await db
    .select()
    .from(creditOrders)
    .where(
      and(eq(creditOrders.id, internalId), eq(creditOrders.userId, userId)),
    )
    .limit(1);
  const order = rows[0];
  if (!order) throw new AppError('not_found');
  const current = await syncPendingOrder(env, db, order);
  return {
    ...publicCreditOrder(current),
    mock: env.SUMOPOD_API_KEY === 'mock',
  };
}

export async function applyReportedPayment(
  db: Database,
  order: typeof creditOrders.$inferSelect,
  report: {
    status: string;
    amount: number | null;
    orderId: string | null;
    paymentId: string | null;
  },
): Promise<typeof creditOrders.$inferSelect> {
  if (order.status !== 'pending') return order;
  if (report.orderId && report.orderId !== order.orderId) return order;
  if (
    report.paymentId &&
    order.sumopodPaymentId &&
    report.paymentId !== order.sumopodPaymentId
  )
    return order;
  const outcome = paymentOutcome(report.status);
  if (outcome === 'pending') return order;
  if (outcome === 'paid') {
    if (report.amount !== order.amountIdr || !order.sumopodPaymentId) {
      logEvent({
        message: 'payment_sync_amount_mismatch',
        userId: order.userId,
        errorCode: 'validation',
      });
      return order;
    }
    try {
      await grantPurchase(db, order, order.sumopodPaymentId, nowIso());
    } catch {
      logEvent({
        message: 'payment_sync_failed',
        userId: order.userId,
        errorCode: 'validation',
      });
    }
  } else {
    await db
      .update(creditOrders)
      .set({ status: outcome })
      .where(
        and(eq(creditOrders.id, order.id), eq(creditOrders.status, 'pending')),
      );
  }
  const rows = await db
    .select()
    .from(creditOrders)
    .where(eq(creditOrders.id, order.id))
    .limit(1);
  return rows[0] ?? order;
}

async function syncPendingOrder(
  env: Env,
  db: Database,
  order: typeof creditOrders.$inferSelect,
) {
  if (
    order.status !== 'pending' ||
    !order.sumopodPaymentId ||
    !order.paymentLinkUrl ||
    env.SUMOPOD_API_KEY === 'mock'
  )
    return order;
  const checkKey = `payment-check:${order.id}`;
  if (await env.APP_KV.get(checkKey)) return order;
  await env.APP_KV.put(checkKey, '1', { expirationTtl: 20 });
  try {
    const remote = await readHostedPayment({
      url: order.paymentLinkUrl,
      amount: order.amountIdr,
      paymentId: order.sumopodPaymentId,
    });
    if (!remote) return order;
    return applyReportedPayment(db, order, remote);
  } catch {
    return order;
  }
}

function paymentOutcome(
  status: string,
): 'paid' | 'pending' | 'failed' | 'expired' {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'paid':
    case 'success':
    case 'succeeded':
      return 'paid';
    case 'failed':
    case 'failure':
      return 'failed';
    case 'expired':
    case 'cancelled':
    case 'canceled':
      return 'expired';
    default:
      return 'pending';
  }
}

export { simulateDevPaymentCompletion };
