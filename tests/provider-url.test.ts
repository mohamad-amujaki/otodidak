import { describe, expect, it } from 'vitest';
import {
  assertAllowedLlmBaseUrl,
  assertAllowedSourceBaseUrl,
} from '../src/domain/provider-url';

describe('provider-url allowlist', () => {
  it('menerima host LLM yang dikenal', () => {
    expect(assertAllowedLlmBaseUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com',
    );
    expect(assertAllowedLlmBaseUrl('https://ai.sumopod.com/v1/')).toBe(
      'https://ai.sumopod.com',
    );
  });

  it('menolak host LLM arbitrer', () => {
    expect(() =>
      assertAllowedLlmBaseUrl('https://evil.example.com/v1'),
    ).toThrow(/diizinkan/);
    expect(() => assertAllowedLlmBaseUrl('http://api.openai.com/v1')).toThrow(
      /HTTPS/,
    );
    expect(() => assertAllowedLlmBaseUrl('https://10.0.0.1/v1')).toThrow(/IP/);
  });

  it('menerima host sumber sesuai jenis', () => {
    expect(
      assertAllowedSourceBaseUrl(
        'https://api.search.brave.com/res/v1/web/search',
        'web',
      ),
    ).toBe('https://api.search.brave.com/res/v1/web/search');
    expect(
      assertAllowedSourceBaseUrl(
        'https://www.googleapis.com/youtube/v3/search',
        'youtube',
      ),
    ).toBe('https://www.googleapis.com/youtube/v3/search');
  });
});
