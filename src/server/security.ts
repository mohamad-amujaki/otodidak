const CSP = [
  "default-src 'self'",
  "script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://api.clerk.com",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self'",
  'frame-src https://*.clerk.accounts.dev https://*.clerk.com',
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const type = headers.get('content-type') ?? '';
  if (type.includes('text/html')) {
    headers.set('content-security-policy', CSP);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}
