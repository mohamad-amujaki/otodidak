import { readCookie, timingSafeEqual } from './crypto';

export const CSRF_COOKIE = 'otodidak_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Token dari cookie HttpOnly (server-side only — tidak bisa dibaca skrip). */
export function csrfFromCookie(header: string | null): string | null {
  return readCookie(header, CSRF_COOKIE);
}

export function verifyCsrfDoubleSubmit(
  cookieHeader: string | null,
  headerToken: string | null,
): boolean {
  const cookie = csrfFromCookie(cookieHeader);
  if (!cookie || !headerToken) return false;
  return timingSafeEqual(cookie, headerToken);
}

/** Tolak POST cross-site modern (pelengkap double-submit + SameSite). */
export function isCrossSiteMutation(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site === 'cross-site';
}
