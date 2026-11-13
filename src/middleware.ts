import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { clerkMiddleware } from '@clerk/astro/server';
import { activePublishableKey, clerkHost } from './domain/guard';
import { cookieHeader, readCookie } from './server/crypto';
import { CSRF_COOKIE } from './server/csrf';
import { isSecure } from './server/security';

export const onRequest = defineMiddleware(async (context, next) => {
  const existing = readCookie(
    context.request.headers.get('cookie'),
    CSRF_COOKIE,
  );
  const token = existing ?? crypto.randomUUID();
  context.locals.csrf = token;
  const publishableKey = activePublishableKey(
    env.PUBLIC_CLERK_PUBLISHABLE_KEY,
    env.CLERK_PUBLISHABLE_KEY,
  );
  const clerkSecret = env.CLERK_SECRET_KEY ?? '';
  const useClerk =
    clerkSecret.startsWith('sk_') && Boolean(clerkHost(publishableKey));
  const response = (
    useClerk
      ? await clerkMiddleware({
          secretKey: clerkSecret,
          publishableKey,
        })(context, next)
      : await next()
  ) as Response;
  if (!existing) {
    response.headers.append(
      'set-cookie',
      cookieHeader(CSRF_COOKIE, token, {
        httpOnly: true,
        secure: isSecure(context.request),
      }),
    );
  }
  return response;
});
