import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import { nowIso } from '../domain/time';
import { DEV_COOKIE, type Identity, signDevSession } from './auth';
import { cookieHeader } from './crypto';
import { isSecure } from './security';

export async function setStreakEnabled(
  db: Database,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .update(users)
    .set({ streakEnabled: enabled ? 1 : 0, updatedAt: nowIso() })
    .where(eq(users.id, userId));
}

export async function requestAccountDeletion(
  db: Database,
  userId: string,
): Promise<string> {
  const when = nowIso();
  await db
    .update(users)
    .set({ deletionRequestedAt: when, updatedAt: when })
    .where(eq(users.id, userId));
  return when;
}

export async function signInDevSession(
  request: Request,
  env: Env,
  identity: Identity,
): Promise<string> {
  if (env.CLERK_SECRET_KEY !== 'mock') throw new Error('not_found');
  const token = await signDevSession(identity, env.CLERK_SECRET_KEY);
  return cookieHeader(DEV_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(request),
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function devLogoutCookie(request: Request): string {
  return cookieHeader(DEV_COOKIE, '', {
    httpOnly: true,
    secure: isSecure(request),
    maxAge: 0,
  });
}
