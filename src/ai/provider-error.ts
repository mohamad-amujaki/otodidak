/** Kode kegagalan yang berasal dari respons atau jaringan penyedia. */
export type ProviderFailureCode =
  | 'provider_auth'
  | 'provider_rate_limit'
  | 'provider_unavailable'
  | 'provider_request';

export type ProviderFailure = {
  code: ProviderFailureCode;
  /** Ringkasan aman untuk UI, mis. "HTTP 401 · invalid API key". */
  detail: string;
};

const MAX_DETAIL = 240;

/** Ambil pesan dari body error provider tanpa membocorkan seluruh body. */
export function providerErrorMessage(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const error = record.error;
      if (typeof error === 'string') return compact(error);
      if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string') return compact(message);
      }
      if (typeof record.message === 'string') return compact(record.message);
    }
  } catch {
    // Bukan JSON: pakai teks mentah yang sudah dirapikan.
  }
  return compact(trimmed);
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL);
}

function redact(value: string, apiKey: string | undefined): string {
  if (!apiKey || apiKey.length < 4) return value;
  return value.split(apiKey).join('[disembunyikan]');
}

/**
 * Petakan status HTTP provider ke kode yang bisa ditindaklanjuti.
 * 401/403 = kunci salah, 429 = dibatasi, 5xx = penyedia bermasalah,
 * 4xx lain = permintaan/model ditolak.
 */
export function providerFailure(
  status: number,
  body: string,
  apiKey?: string,
): ProviderFailure {
  const message = providerErrorMessage(body);
  const detail = redact(
    compact(`HTTP ${status}${message ? ` · ${message}` : ''}`),
    apiKey,
  );
  const code: ProviderFailureCode =
    status === 401 || status === 403
      ? 'provider_auth'
      : status === 429
        ? 'provider_rate_limit'
        : status >= 500
          ? 'provider_unavailable'
          : 'provider_request';
  return { code, detail };
}

/** Kegagalan ini tidak akan membaik dengan mengulang permintaan yang sama. */
export function isPermanentProviderFailure(code: string): boolean {
  return (
    code === 'provider_auth' ||
    code === 'provider_request' ||
    code === 'invalid_output'
  );
}
