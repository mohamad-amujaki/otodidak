import { describe, expect, it } from 'vitest';
import {
  creditGap,
  creditShortNote,
  creditTopUpFor,
  hasEnoughCredits,
  safeReturnPath,
} from '../src/domain/credit-ui';

describe('credit hint', () => {
  it('accepts a balance that covers the cost', () => {
    expect(hasEnoughCredits(3, 3)).toBe(true);
    expect(hasEnoughCredits(10, 1)).toBe(true);
    expect(creditGap(3, 3)).toBe(0);
  });

  it('rejects a balance below the cost', () => {
    expect(hasEnoughCredits(0, 1)).toBe(false);
    expect(hasEnoughCredits(1, 3)).toBe(false);
    expect(creditGap(1, 3)).toBe(2);
    expect(creditGap(0, 3)).toBe(3);
  });

  it('describes the shortfall with real numbers', () => {
    expect(creditShortNote(0, 1)).toBe('Butuh 1 kredit · saldo kamu 0');
    expect(creditShortNote(1, 3)).toBe('Butuh 3 kredit · saldo kamu 1');
  });
});

describe('credit return path', () => {
  it('keeps same-origin paths only', () => {
    expect(safeReturnPath('/jalur/a/pelajaran/b?lanjut=kuis')).toBe(
      '/jalur/a/pelajaran/b?lanjut=kuis',
    );
    expect(safeReturnPath('//evil.example.com')).toBeNull();
    expect(safeReturnPath('https://evil.example.com')).toBeNull();
    expect(safeReturnPath('jalur/a')).toBeNull();
    expect(safeReturnPath('')).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });

  it('builds a top-up link that carries the return path', () => {
    expect(creditTopUpFor('/jalur/a?lanjut=kuis')).toBe(
      '/kredit?kembali=%2Fjalur%2Fa%3Flanjut%3Dkuis',
    );
    expect(creditTopUpFor('https://evil.example.com')).toBe(
      '/kredit#paket-kredit',
    );
    expect(creditTopUpFor(null)).toBe('/kredit#paket-kredit');
  });
});
