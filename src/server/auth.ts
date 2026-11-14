import { createClerkClient } from '@clerk/backend';
import { clerkPublishableKeyFromEnv } from '../domain/guard';
import {
  decodeBase64Url,
  encodeBase64Url,
  hmacSha256Base64,
  readCookie,
  sha256Hex,
  timingSafeEqual,
} from './crypto';

export type Identity = { clerkUserId: string; email: string; name: string };

const DEV_COOKIE = 'otodidak_dev';
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const CLERK_IDENTITY_TTL_SECONDS = 60;

type CachedIdentity = Identity & { exp: number };

type DevPayload = Identity & { exp: number };

export async function identify(
  request: Request,
  env: Env,
): Promise<Identity | null> {
  if (env.CLERK_SECRET_KEY === 'mock')
    return readDevSession(request, env.CLERK_SECRET_KEY);
  return readClerk(request, env);
}

export async function signDevSession(
  identity: Identity,
  secret: string,
): Promise<string> {
  const payload: DevPayload = {
    ...identity,
    exp: Math.floor(Date.now() / 1000) + WEEK_SECONDS,
  };
  const body = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await hmacSha256Base64(
    new TextEncoder().encode(secret),
    body,
  );
  return `${body}.${signature}`;
}

export async function devIdentityFor(
  email: string,
  name: string,
): Promise<Identity> {
  const digest = await sha256Hex(email.toLowerCase());
  return { clerkUserId: `dev_${digest.slice(0, 32)}`, email, name };
}

export { DEV_COOKIE };

async function readDevSession(
  request: Request,
  secret: string,
): Promise<Identity | null> {
  const token = readCookie(request.headers.get('cookie'), DEV_COOKIE);
  if (!token) return null;
  const splitAt = token.indexOf('.');
  if (splitAt <= 0) return null;
  const body = token.slice(0, splitAt);
  const signature = token.slice(splitAt + 1);
  const expected = await hmacSha256Base64(
    new TextEncoder().encode(secret),
    body,
  );
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const json = new TextDecoder().decode(decodeBase64Url(body));
    const payload = JSON.parse(json) as DevPayload;
    if (!payload.clerkUserId || !payload.email || !payload.name) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      clerkUserId: payload.clerkUserId,
      email: payload.email,
      name: payload.name,
    };
  } catch {
    return null;
  }
}

function clerkEmail(user: {
  primaryEmailAddress: { emailAddress: string } | null;
  emailAddresses: Array<{ emailAddress: string }>;
  externalAccounts: Array<{ emailAddress: string; provider: string }>;
}): string | null {
  const google = user.externalAccounts.find(
    (account) => account.provider.includes('google') && account.emailAddress,
  );
  return (
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses.find((item) => item.emailAddress)?.emailAddress ||
    google?.emailAddress ||
    user.externalAccounts.find((account) => account.emailAddress)
      ?.emailAddress ||
    null
  );
}

async function readClerk(request: Request, env: Env): Promise<Identity | null> {
  const publishableKey = clerkPublishableKeyFromEnv(env);
  const client = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey,
  });
  const state = await client.authenticateRequest(request, {
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey,
  });
  if (!state.isAuthenticated) return null;
  const userId = state.toAuth().userId;
  if (!userId) return null;
  const cacheKey = `clerk:identity:${userId}`;
  const cached = await env.APP_KV.get<CachedIdentity>(cacheKey, 'json');
  const now = Math.floor(Date.now() / 1000);
  if (cached?.clerkUserId && cached.email && cached.name && cached.exp > now) {
    return {
      clerkUserId: cached.clerkUserId,
      email: cached.email,
      name: cached.name,
    };
  }
  const user = await client.users.getUser(userId);
  const email = clerkEmail(user);
  if (!email) return null;
  const name = user.fullName || user.firstName || email;
  const identity: Identity = { clerkUserId: userId, email, name };
  await env.APP_KV.put(
    cacheKey,
    JSON.stringify({
      ...identity,
      exp: now + CLERK_IDENTITY_TTL_SECONDS,
    } satisfies CachedIdentity),
    { expirationTtl: CLERK_IDENTITY_TTL_SECONDS + 30 },
  );
  return identity;
}
