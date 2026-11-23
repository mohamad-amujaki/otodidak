import { describe, expect, it } from 'vitest';
import { hostedPaymentReport } from '../src/billing/hosted-payment';
import { isSandboxPaymentUrl, sumopodApiBase } from '../src/billing/sumopod';

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

describe('basis API pembayaran', () => {
  it('production selalu memakai API live', () => {
    expect(
      sumopodApiBase(
        'production',
        'https://api-pay-sandbox.sumopod.com/api/v1',
      ),
    ).toBe('https://api-pay.sumopod.com/api/v1');
    expect(
      sumopodApiBase(
        'development',
        'https://api-pay-sandbox.sumopod.com/api/v1/',
      ),
    ).toBe('https://api-pay-sandbox.sumopod.com/api/v1');
  });

  it('mengenali host sandbox', () => {
    expect(
      isSandboxPaymentUrl(
        'https://sumo.sandbox.pymnt.global/payment-links/abc',
      ),
    ).toBe(true);
    expect(isSandboxPaymentUrl('https://checkout.pymnt.app/sesi')).toBe(false);
  });
});
