import { describe, expect, it } from 'vitest';
import {
  isPermanentProviderFailure,
  providerErrorMessage,
  providerFailure,
} from '../src/ai/provider-error';

describe('providerFailure', () => {
  it('memetakan status auth ke provider_auth dengan pesan provider', () => {
    const failure = providerFailure(
      401,
      JSON.stringify({ error: { message: 'invalid API key' } }),
    );
    expect(failure.code).toBe('provider_auth');
    expect(failure.detail).toBe('HTTP 401 · invalid API key');
  });

  it('memetakan 429, 5xx, dan 4xx lain ke kode yang berbeda', () => {
    expect(providerFailure(429, '').code).toBe('provider_rate_limit');
    expect(providerFailure(503, '').code).toBe('provider_unavailable');
    expect(providerFailure(400, 'model tidak dikenal').code).toBe(
      'provider_request',
    );
  });

  it('menyembunyikan kunci API bila ikut muncul di pesan', () => {
    const failure = providerFailure(
      401,
      'invalid key sk-rahasia-panjang',
      'sk-rahasia-panjang',
    );
    expect(failure.detail).not.toContain('sk-rahasia-panjang');
    expect(failure.detail).toContain('[disembunyikan]');
  });

  it('memotong detail agar tidak membanjiri UI', () => {
    const failure = providerFailure(500, 'x'.repeat(1000));
    expect(failure.detail.length).toBeLessThanOrEqual(240);
  });

  it('hanya kegagalan permanen yang tidak diulang', () => {
    expect(isPermanentProviderFailure('provider_auth')).toBe(true);
    expect(isPermanentProviderFailure('provider_request')).toBe(true);
    expect(isPermanentProviderFailure('invalid_output')).toBe(true);
    expect(isPermanentProviderFailure('provider_rate_limit')).toBe(false);
    expect(isPermanentProviderFailure('provider_unavailable')).toBe(false);
    expect(isPermanentProviderFailure('provider_timeout')).toBe(false);
  });
});

describe('providerErrorMessage', () => {
  it('membaca berbagai bentuk body error', () => {
    expect(providerErrorMessage('{"error":"ditolak"}')).toBe('ditolak');
    expect(providerErrorMessage('{"message":"salah"}')).toBe('salah');
    expect(providerErrorMessage('  teks   biasa \n')).toBe('teks biasa');
    expect(providerErrorMessage('')).toBeNull();
  });
});
