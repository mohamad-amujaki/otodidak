import { sumopodPaymentSchema } from '../domain/schemas';

export type CreatedPayment = {
  paymentId: string;
  paymentLinkUrl: string;
  paymentCode: string | null;
};

export async function createQrisPayment(input: {
  apiKey: string;
  baseUrl: string;
  orderId: string;
  amount: number;
  returnUrl: string | null;
}): Promise<CreatedPayment> {
  if (input.apiKey === 'mock') {
    return {
      paymentId: `pay_${input.orderId}`,
      paymentLinkUrl:
        input.returnUrl ?? `https://pay.sumopod.example/link/${input.orderId}`,
      paymentCode: '000201MOCK',
    };
  }
  const body: Record<string, unknown> = {
    order_id: input.orderId,
    amount: input.amount,
    currency: 'IDR',
    payment_method_type_code: 'QRIS',
  };
  if (input.returnUrl?.startsWith('https://'))
    body.success_return_url = input.returnUrl;
  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': input.apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('payment_create_failed');
  const parsed = sumopodPaymentSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('payment_create_invalid');
  return {
    paymentId: parsed.data.payment_id,
    paymentLinkUrl: parsed.data.payment_link_url,
    paymentCode: parsed.data.payment_code ?? null,
  };
}
