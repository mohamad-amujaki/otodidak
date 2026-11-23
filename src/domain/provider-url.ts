import { AppError } from './errors';

/** Hostname HTTPS yang boleh dipakai untuk endpoint chat/completions. */
export const LLM_PROVIDER_HOSTS = [
  'ai.sumopod.com',
  'router.ariaseta.com',
  'api.openai.com',
  'openrouter.ai',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'api.together.xyz',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.perplexity.ai',
  'api.x.ai',
] as const;

const LLM_PROVIDER_HOST_SET = new Set<string>(LLM_PROVIDER_HOSTS);

/**
 * Preset untuk datalist di form admin. Semua host wajib ada di allowlist di atas;
 * tes `provider-url.test.ts` menjaga keduanya tetap sinkron.
 */
export const LLM_BASE_URL_PRESETS = [
  {
    host: 'ai.sumopod.com',
    label: 'Sumopod',
    baseUrl: 'https://ai.sumopod.com/v1',
  },
  {
    host: 'router.ariaseta.com',
    label: 'Router Ariaseta',
    baseUrl: 'https://router.ariaseta.com/v1',
  },
  {
    host: 'api.openai.com',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    host: 'openrouter.ai',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    host: 'api.deepseek.com',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  {
    host: 'api.groq.com',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  {
    host: 'api.together.xyz',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
  },
  {
    host: 'api.mistral.ai',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
  },
  {
    host: 'api.x.ai',
    label: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
  },
  {
    host: 'api.perplexity.ai',
    label: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
  },
  {
    host: 'generativelanguage.googleapis.com',
    label: 'Google Gemini (OpenAI-compatible)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    host: 'api.anthropic.com',
    label: 'Anthropic (bukan OpenAI-compatible)',
    baseUrl: 'https://api.anthropic.com/v1',
  },
] as const;

const SOURCE_PROVIDER_HOSTS: Record<'web' | 'youtube', Set<string>> = {
  web: new Set(['api.search.brave.com']),
  youtube: new Set(['www.googleapis.com']),
};

const BLOCKED_HOST_SUFFIXES = [
  '.internal',
  '.local',
  '.localhost',
  'metadata.google',
];

function isIpHostname(host: string): boolean {
  if (host.includes(':')) return true;
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function parseHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('validation', 'URL provider tidak valid.');
  }
  if (url.username || url.password)
    throw new AppError(
      'validation',
      'URL provider tidak boleh berisi kredensial.',
    );
  if (url.protocol !== 'https:')
    throw new AppError('validation', 'URL provider harus memakai HTTPS.');
  const host = url.hostname.toLowerCase();
  if (isIpHostname(host))
    throw new AppError(
      'validation',
      'URL provider tidak boleh memakai alamat IP.',
    );
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix))
      throw new AppError('validation', 'Host provider tidak diizinkan.');
  }
  return url;
}

export function assertAllowedLlmBaseUrl(raw: string): string {
  const url = parseHttpsUrl(raw);
  if (!LLM_PROVIDER_HOST_SET.has(url.hostname))
    throw new AppError(
      'validation',
      'Host base URL model tidak ada di daftar yang diizinkan.',
    );
  return url.origin;
}

export function assertAllowedSourceBaseUrl(
  raw: string,
  kind: 'web' | 'youtube',
): string {
  const url = parseHttpsUrl(raw);
  if (!SOURCE_PROVIDER_HOSTS[kind].has(url.hostname))
    throw new AppError(
      'validation',
      'Host penyedia sumber tidak ada di daftar yang diizinkan.',
    );
  return url.origin + url.pathname.replace(/\/$/, '');
}

/** Di fetch: tolak base URL yang tidak lolos allowlist (mis. data lama di DB). */
export function requireAllowedLlmBaseUrl(raw: string): void {
  assertAllowedLlmBaseUrl(raw);
}
