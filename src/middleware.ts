import { defineMiddleware } from 'astro:middleware';
import { cookieHeader, readCookie } from './server/crypto';
import { isSecure } from './server/security';

export const onRequest = defineMiddleware(async (context, next) => {
  const existing = readCookie(
    context.request.headers.get('cookie'),
    'otodidak_csrf',
  );
  const token = existing ?? crypto.randomUUID();
  context.locals.csrf = token;
  const response = await next();
  if (!existing) {
    response.headers.append(
      'set-cookie',
      cookieHeader('otodidak_csrf', token, {
        secure: isSecure(context.request),
      }),
    );
  }
  return response;
});
