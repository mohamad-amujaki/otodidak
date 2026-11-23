import { describe, expect, it } from 'vitest';
import { hostedPaymentReport } from '../src/billing/hosted-payment';

const paymentId = 'fa9a0000-0000-4000-8000-000000000001';

function page(extra: string) {
  return `<html>"payment_id":"${paymentId}","amount":"25000","page_status":"success"${extra}</html>`;
}

describe('status halaman pembayaran', () => {
  it('mengakui halaman sukses dengan nominal yang sama', () => {
    const report = hostedPaymentReport({
      finalUrl: 'https://checkout.pymnt.app/sesi/success',
      body: page('').replaceAll('"', '\\"'),
      amount: 25000,
      paymentId,
    });
    expect(report?.status).toBe('completed');
    expect(report?.amount).toBe(25000);
  });

  it('mengabaikan halaman yang belum sukses atau nominalnya beda', () => {
    expect(
      hostedPaymentReport({
        finalUrl: 'https://checkout.pymnt.app/sesi/bayar',
        body: page(''),
        amount: 25000,
        paymentId,
      }),
    ).toBeNull();
    expect(
      hostedPaymentReport({
        finalUrl: 'https://checkout.pymnt.app/sesi/success',
        body: page('').replace('"amount":"25000"', '"amount":"1"'),
        amount: 25000,
        paymentId,
      }),
    ).toBeNull();
    expect(
      hostedPaymentReport({
        finalUrl: 'https://evil.example/sesi/success',
        body: page(''),
        amount: 25000,
        paymentId,
      }),
    ).toBeNull();
  });
});
