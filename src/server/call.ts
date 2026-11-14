import { createApp } from './app';
import { readCookie } from './crypto';
import { CSRF_COOKIE, CSRF_HEADER } from './csrf';

const app = createApp();

export type ApiResult = { status: number; data: unknown; setCookie: string[] };

export async function callApi(
  request: Request,
  env: Env,
  path: string,
  init?: { method?: string; json?: unknown; csrf?: string },
): Promise<ApiResult> {
  const headers = new Headers();
  const incoming = request.headers.get('cookie') ?? '';
  const csrf = init?.csrf ?? readCookie(incoming, CSRF_COOKIE);
  if (incoming) headers.set('cookie', incoming);
  const method = init?.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('content-type', 'application/json');
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }
  const response = await app.fetch(
    new Request(new URL(path, request.url), {
      method,
      headers,
      body: init?.json === undefined ? undefined : JSON.stringify(init.json),
    }),
    env,
  );
  const data = await response.json().catch(() => null);
  const setCookie =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
  return { status: response.status, data, setCookie };
}

export function errorOf(
  data: unknown,
): { code: string; message: string } | null {
  if (!data || typeof data !== 'object' || !('error' in data)) return null;
  const error = data.error;
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    !('message' in error)
  )
    return null;
  if (typeof error.code !== 'string' || typeof error.message !== 'string')
    return null;
  return { code: error.code, message: error.message };
}
