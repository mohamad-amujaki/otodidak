import { env } from 'cloudflare:workers';
import { isRecord, record } from '../domain/guard';
import { isSuperadmin } from './admin-access';
import { fetchAdminStats } from './admin-data';
import { mePayload } from './read';
import { type PageSession, pageSession } from './ssr';

export type AdminNavStats = {
  pendingOrders: number;
  jobsFailed: number;
  deletionRequests: number;
};

export type AdminContext = {
  me: Record<string, unknown>;
  user: Record<string, unknown>;
  balance: number;
  superadmin: boolean;
  nav?: AdminNavStats;
  session: PageSession;
};

type AdminGate = { redirect: string } | AdminContext;

type RequireAdminOptions = { nav?: boolean };

function gate(context: AdminContext): AdminGate {
  return context;
}

function navFromStats(data: Awaited<ReturnType<typeof fetchAdminStats>>) {
  return {
    pendingOrders: data.pendingOrders,
    jobsFailed: data.jobsFailed,
    deletionRequests: data.deletionRequests,
  };
}

export async function requireAdmin(
  request: Request,
  options?: RequireAdminOptions,
): Promise<AdminGate> {
  const session = await pageSession(request, env);
  if (!session) return { redirect: '/masuk' };
  const meRaw = await mePayload(session.db, session.user);
  const me = meRaw as Record<string, unknown>;
  if (!isRecord(me)) return { redirect: '/masuk' };
  const user = record(me.user);
  if (user.role !== 'admin') return { redirect: '/dasbor' };
  const email = typeof user.email === 'string' ? user.email : '';
  const stats = options?.nav ? await fetchAdminStats(session.db) : undefined;
  return gate({
    me,
    user,
    balance: typeof me.balance === 'number' ? me.balance : 0,
    superadmin: isSuperadmin(env, email),
    nav: stats ? navFromStats(stats) : undefined,
    session,
  });
}

export async function requireSuperadminPage(
  request: Request,
  options?: RequireAdminOptions,
): Promise<AdminGate> {
  const auth = await requireAdmin(request, options);
  if ('redirect' in auth) return auth;
  if (!auth.superadmin) return { redirect: '/admin' };
  return auth;
}
