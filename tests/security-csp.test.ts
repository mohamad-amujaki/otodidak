import { describe, expect, it } from 'vitest';
import { htmlUsesDevViteStyles } from '../src/server/security';

const env = { ENVIRONMENT: 'development' } as Env;

describe('htmlUsesDevViteStyles', () => {
  it('mengizinkan inline style di localhost dev', () => {
    expect(
      htmlUsesDevViteStyles(env, new Request('http://localhost:8787/dasbor')),
    ).toBe(true);
  });

  it('menolak inline style di produksi', () => {
    expect(
      htmlUsesDevViteStyles(
        { ENVIRONMENT: 'production' } as unknown as Env,
        new Request('https://otodidak.example/dasbor'),
      ),
    ).toBe(false);
  });
});
