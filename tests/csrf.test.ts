import { describe, expect, it } from 'vitest';
import {
  isCrossSiteMutation,
  verifyCsrfDoubleSubmit,
} from '../src/server/csrf';

describe('csrf', () => {
  it('double-submit cocok', () => {
    const cookie = 'otodidak_csrf=abc123';
    expect(verifyCsrfDoubleSubmit(cookie, 'abc123')).toBe(true);
    expect(verifyCsrfDoubleSubmit(cookie, 'xyz')).toBe(false);
  });

  it('menandai cross-site', () => {
    expect(
      isCrossSiteMutation(
        new Request('https://otodidak.test/api/me', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site' },
        }),
      ),
    ).toBe(true);
    expect(
      isCrossSiteMutation(
        new Request('https://otodidak.test/api/me', { method: 'POST' }),
      ),
    ).toBe(false);
  });
});
