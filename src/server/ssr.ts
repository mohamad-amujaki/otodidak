import type { Database } from '../db/client';
import type { UserRow } from '../db/schema';
import { database, ensureUser } from './account';
import { type Identity, identify } from './auth';
import { mePayload } from './read';

export type PageSession = {
  db: Database;
  user: UserRow;
  identity: Identity;
};

/** Satu auth + satu koneksi D1 per render halaman Astro (hindari rantai callApi). */
export async function pageSession(
  request: Request,
  env: Env,
): Promise<PageSession | null> {
  const identity = await identify(request, env);
  if (!identity) return null;
  const db = await database(env);
  const user = await ensureUser(db, env, identity);
  return { db, user, identity };
}

export type PageMe = Awaited<ReturnType<typeof mePayload>>;

export async function pageMe(
  request: Request,
  env: Env,
): Promise<{ session: PageSession; me: PageMe } | { redirect: '/masuk' }> {
  const session = await pageSession(request, env);
  if (!session) return { redirect: '/masuk' };
  const me = await mePayload(session.db, session.user);
  return { session, me };
}
