const HOSTS = new Set(['checkout.pymnt.app']);

export type HostedPaymentReport = {
  status: 'completed';
  amount: number;
  orderId: null;
  paymentId: string;
};

export function hostedPaymentReport(input: {
  finalUrl: string;
  body: string;
  amount: number;
  paymentId: string;
}): HostedPaymentReport | null {
  let url: URL;
  try {
    url = new URL(input.finalUrl);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname)) return null;
  if (!url.pathname.endsWith('/success')) return null;
  const body = input.body.replaceAll('\\"', '"');
  if (!body.includes(input.paymentId)) return null;
  if (!body.includes('"page_status":"success"')) return null;
  const amountText = String(input.amount);
  const amountShown =
    body.includes(`"amount":"${amountText}"`) ||
    body.includes(`"amount":${amountText}`);
  if (!amountShown) return null;
  return {
    status: 'completed',
    amount: input.amount,
    orderId: null,
    paymentId: input.paymentId,
  };
}

export async function readHostedPayment(input: {
  url: string;
  amount: number;
  paymentId: string;
}): Promise<HostedPaymentReport | null> {
  let start: URL;
  try {
    start = new URL(input.url);
  } catch {
    return null;
  }
  if (!HOSTS.has(start.hostname)) return null;
  const response = await fetch(start, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Otodidak/1.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const body = (await response.text()).slice(0, 200_000);
  return hostedPaymentReport({
    finalUrl: response.url,
    body,
    amount: input.amount,
    paymentId: input.paymentId,
  });
}
