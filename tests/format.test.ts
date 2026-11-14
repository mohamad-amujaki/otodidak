import { describe, expect, it } from 'vitest';
import { alphaLabel } from '../src/domain/format';

describe('alphaLabel', () => {
  it('memetakan indeks ke huruf tanpa peduli batas alfabet', () => {
    expect(alphaLabel(0)).toBe('A');
    expect(alphaLabel(1)).toBe('B');
    expect(alphaLabel(25)).toBe('Z');
    expect(alphaLabel(26)).toBe('AA');
    expect(alphaLabel(27)).toBe('AB');
  });

  it('tidak menghasilkan label kosong untuk masukan tak wajar', () => {
    expect(alphaLabel(-3)).toBe('A');
  });
});
