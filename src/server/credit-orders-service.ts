import { and, eq } from 'drizzle-orm';
import { createQrisPayment } from '../billing/sumopod';
import type { Database } from '../db/client';
import { creditOrders, creditPacks, type UserRow } from '../db/schema';
import { AppError } from '../domain/errors';
import { nowIso } from '../domain/time';
import { logEvent } from './log';
import { requestAppOrigin } from './origin';
import { simulateDevPaymentCompletion } from './payment-webhook';

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
      baseUrl: env.SUMOPOD_API_BASE,
      orderId,
      amount: pack.priceIdr,
      returnUrl,
      qrPageUrl,
    });
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
  return {
    ...publicCreditOrder(order),
    mock: env.SUMOPOD_API_KEY === 'mock',
  };
}

export { simulateDevPaymentCompletion };
