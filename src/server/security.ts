const CSP_REST = [
  "default-src 'self'",
  "script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com",
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://api.clerk.com",
  "img-src 'self' data:",
  "font-src 'self'",
  'frame-src https://*.clerk.accounts.dev https://*.clerk.com',
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

function contentSecurityPolicy(html: string): string {
  // Vite inlines the Tailwind sheet in a <style data-vite-dev-id> tag during
  // `astro dev`. style-src 'self' blocks that tag, so the page has no layout.
  // A production build links a same-origin stylesheet, which 'self' allows.
  const styleSrc = html.includes('data-vite-dev-id')
    ? "style-src 'self' 'unsafe-inline'"
    : "style-src 'self'";
  return [styleSrc, ...CSP_REST].join('; ');
}

export async function withSecurityHeaders(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  const type = headers.get('content-type') ?? '';
  if (!type.includes('text/html')) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const html = await response.text();
  headers.set('content-security-policy', contentSecurityPolicy(html));
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}
