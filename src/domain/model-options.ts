import { CURATED_MODELS } from './defaults';

export type ModelOption = {
  id: string;
  /** Batas token keluaran menurut provider; null kalau tidak dilaporkan. */
  maxOutputTokens: number | null;
};

export type ModelOptionSource = 'live' | 'cache' | 'fallback';

export type ModelOptions = {
  models: ModelOption[];
  source: ModelOptionSource;
  error: string | null;
  checkedAt: string | null;
};

/** Bentuk respons `GET /v1/models` yang kompatibel OpenAI. */
export function normalizeModelPayload(payload: unknown): ModelOption[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const models: ModelOption[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { id?: unknown; max_output_tokens?: unknown };
    if (typeof record.id !== 'string' || record.id.trim().length === 0)
      continue;
    const max = Number(record.max_output_tokens);
    models.push({
      id: record.id.trim(),
      maxOutputTokens: Number.isFinite(max) && max > 0 ? max : null,
    });
  }
  return models;
}

/** Model kurasi selalu tersedia, model dari provider menimpa metadata-nya. */
export function mergeModelOptions(live: ModelOption[]): ModelOption[] {
  const merged = new Map<string, ModelOption>();
  for (const model of CURATED_MODELS)
    merged.set(model.id, { id: model.id, maxOutputTokens: null });
  for (const model of live) merged.set(model.id, model);
  return [...merged.values()];
}

/** Cadangan saat provider tidak bisa dihubungi. */
export function fallbackModelOptions(): ModelOption[] {
  return mergeModelOptions([]);
}
