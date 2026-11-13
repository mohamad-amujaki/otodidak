import { createClerkClient } from '@clerk/backend';
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

async function readClerk(request: Request, env: Env): Promise<Identity | null> {
  const client = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  });
  const state = await client.authenticateRequest(request, {
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  });
  if (!state.isAuthenticated) return null;
  const userId = state.toAuth().userId;
  if (!userId) return null;
  const user = await client.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;
  if (!email) return null;
  const name = user.fullName || user.firstName || email;
  return { clerkUserId: userId, email, name };
}
