import { env } from 'cloudflare:workers';
import { isRecord, record } from '../domain/guard';
import { isSuperadmin } from './admin-access';
import { callApi } from './call';

export type AdminContext = {
  me: Record<string, unknown>;
  user: Record<string, unknown>;
  balance: number;
  superadmin: boolean;
};

type AdminGate = { redirect: string } | AdminContext;

function gate(context: AdminContext): AdminGate {
  return context;
}

export async function requireAdmin(request: Request): Promise<AdminGate> {
  const meResult = await callApi(request, env, '/api/me');
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
  });
}

export async function requireSuperadminPage(
  request: Request,
): Promise<AdminGate> {
  const auth = await requireAdmin(request);
  if ('redirect' in auth) return auth;
  if (!auth.superadmin) return { redirect: '/admin' };
  return auth;
}
