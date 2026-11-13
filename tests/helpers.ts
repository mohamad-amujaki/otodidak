import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import worker from '../src/entry';

const csrf = 'csrf-test-token';

export async function api(
  path: string,
  init?: {
    method?: string;
    json?: unknown;
    body?: string;
    cookie?: string;
    headers?: HeadersInit;
  },
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const cookie = [`otodidak_csrf=${csrf}`, init?.cookie]
    .filter(Boolean)
    .join('; ');
  headers.set('cookie', cookie);
  if ((init?.method ?? 'GET') !== 'GET') headers.set('x-csrf-token', csrf);
  if (init?.json !== undefined) headers.set('content-type', 'application/json');
  const body =
    init?.body ??
    (init?.json === undefined ? undefined : JSON.stringify(init.json));
  return worker.fetch(
    new Request(`https://otodidak.test${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body,
    }),
    env,
    createExecutionContext(),
  );
}

export function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/otodidak_dev=[^;]+/);
  if (!match) throw new Error('sesi tidak ada');
  return match[0];
}

export async function signIn(
  email: string,
  name = 'Pengguna Percobaan',
): Promise<string> {
  const response = await api('/api/dev/session', {
    method: 'POST',
    json: { email, name },
  });
  if (!response.ok) throw new Error(`masuk gagal ${response.status}`);
  return sessionCookie(response);
}

export async function jsonBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
