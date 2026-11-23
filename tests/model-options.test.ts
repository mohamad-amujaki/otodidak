import { describe, expect, it } from 'vitest';
import { CURATED_MODELS, DEFAULT_MODEL_NAME } from '../src/domain/defaults';
import {
  fallbackModelOptions,
  mergeModelOptions,
  normalizeModelPayload,
} from '../src/domain/model-options';
import { modelSchema, providerConnectionSchema } from '../src/domain/schemas';

describe('daftar model penyedia', () => {
  it('membaca id dan batas token dari respons /models', () => {
    const models = normalizeModelPayload({
      data: [
        { id: 'deepseek-v4.1-flash-1017', max_output_tokens: 1048576 },
        { id: 'deepseek-flash', max_output_tokens: 1048576 },
      ],
    });
    expect(models).toEqual([
      { id: 'deepseek-v4.1-flash-1017', maxOutputTokens: 1048576 },
      { id: 'deepseek-flash', maxOutputTokens: 1048576 },
    ]);
  });

  it('mengabaikan entri rusak dan payload yang bukan daftar', () => {
    expect(normalizeModelPayload(null)).toEqual([]);
    expect(normalizeModelPayload({ data: 'bukan array' })).toEqual([]);
    expect(
      normalizeModelPayload({
        data: [{ id: '' }, { max_output_tokens: 10 }, { id: 'ok' }],
      }),
    ).toEqual([{ id: 'ok', maxOutputTokens: null }]);
  });

  it('mempertahankan model kurasi dan menimpa metadatanya dari provider', () => {
    const merged = mergeModelOptions([
      { id: 'deepseek-v4.1-flash-1017', maxOutputTokens: 1048576 },
      { id: 'gpt-5.4', maxOutputTokens: 64000 },
    ]);
    const defaultModel = merged.find((m) => m.id === DEFAULT_MODEL_NAME);
    expect(defaultModel?.maxOutputTokens).toBe(1048576);
    expect(merged.map((m) => m.id)).toContain('gpt-5.4');
    for (const model of CURATED_MODELS)
      expect(merged.map((m) => m.id)).toContain(model.id);
  });

  it('cadangan selalu memuat model kurasi', () => {
    expect(fallbackModelOptions().map((m) => m.id)).toEqual(
      CURATED_MODELS.map((m) => m.id),
    );
  });
});

describe('validasi form admin AI', () => {
  it('modelSchema menolak batas token di luar rentang', () => {
    expect(
      modelSchema.safeParse({
        modelName: 'deepseek-flash',
        maxOutputTokens: 99,
        timeoutMs: 5000,
      }).success,
    ).toBe(false);
    expect(
      modelSchema.safeParse({
        modelName: 'deepseek-flash',
        maxOutputTokens: 8001,
        timeoutMs: 5000,
      }).success,
    ).toBe(false);
    expect(
      modelSchema.safeParse({
        modelName: 'deepseek-flash',
        maxOutputTokens: 4096,
        timeoutMs: 5000,
      }).success,
    ).toBe(true);
  });

  it('koneksi penyedia wajib HTTPS, bukan alamat kosong', () => {
    expect(
      providerConnectionSchema.safeParse({
        baseUrl: 'http://ai.sumopod.com/v1',
        secretName: 'OPENAI_API_KEY',
      }).success,
    ).toBe(false);
    expect(
      providerConnectionSchema.safeParse({
        baseUrl: '',
        secretName: 'OPENAI_API_KEY',
      }).success,
    ).toBe(false);
    expect(
      providerConnectionSchema.safeParse({
        baseUrl: 'https://ai.sumopod.com/v1/',
        secretName: 'OPENAI_API_KEY',
      }).success,
    ).toBe(true);
  });
});
