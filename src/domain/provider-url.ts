import { AppError } from './errors';

/** Hostname HTTPS yang boleh dipakai untuk endpoint chat/completions. */
const LLM_PROVIDER_HOSTS = new Set([
  'ai.sumopod.com',
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
]);

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
  if (!LLM_PROVIDER_HOSTS.has(url.hostname))
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
