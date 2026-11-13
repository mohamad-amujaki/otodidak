import { env } from 'cloudflare:workers';
import { isRecord, record } from '../domain/guard';
import { isSuperadmin } from './admin-access';
import { callApi } from './call';

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
};

type AdminGate = { redirect: string } | AdminContext;

type RequireAdminOptions = { nav?: boolean };

function gate(context: AdminContext): AdminGate {
  return context;
}

function navFromStats(data: unknown): AdminNavStats | undefined {
  if (!isRecord(data)) return undefined;
  return {
    pendingOrders: Number(data.pendingOrders ?? 0),
    jobsFailed: Number(data.jobsFailed ?? 0),
    deletionRequests: Number(data.deletionRequests ?? 0),
  };
}

export async function requireAdmin(
  request: Request,
  options?: RequireAdminOptions,
): Promise<AdminGate> {
  const [meResult, statsResult] = await Promise.all([
    callApi(request, env, '/api/me'),
    options?.nav
      ? callApi(request, env, '/api/admin/stats')
      : Promise.resolve(null),
  ]);
  if (meResult.status !== 200) return { redirect: '/masuk' };
  if (!isRecord(meResult.data)) return { redirect: '/masuk' };
  const me = meResult.data;
  const user = record(me.user);
  if (user.role !== 'admin') return { redirect: '/dasbor' };
  const email = typeof user.email === 'string' ? user.email : '';
  return gate({
    me,
    user,
    balance: typeof me.balance === 'number' ? me.balance : 0,
    superadmin: isSuperadmin(env, email),
    nav: options?.nav ? navFromStats(statsResult?.data) : undefined,
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
