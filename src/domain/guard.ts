export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function clerkPublishableKeyFromEnv(env: {
  PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
}): string {
  return activePublishableKey(
    env.PUBLIC_CLERK_PUBLISHABLE_KEY,
    env.CLERK_PUBLISHABLE_KEY,
  );
}

export function activePublishableKey(
  ...candidates: Array<string | undefined>
): string {
  return (
    candidates.find((key) => Boolean(key && clerkHost(key))) ??
    candidates.find((key) => Boolean(key)) ??
    ''
  );
}

/** Clerk siap dipakai: secret asli + publishable key yang bisa di-decode. */
export function clerkConfigured(env: {
  PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
}): boolean {
  if (!env.CLERK_SECRET_KEY || env.CLERK_SECRET_KEY === 'mock') return false;
  return Boolean(clerkHost(clerkPublishableKeyFromEnv(env)));
}

/**
 * Sesi percobaan aktif untuk tes, atau untuk dev ketika Clerk belum lengkap.
 * Production selalu fail closed (bukan sesi percobaan).
 */
export function devAuthEnabled(env: {
  PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  ENVIRONMENT?: string;
}): boolean {
  if (env.CLERK_SECRET_KEY === 'mock') return true;
  if (clerkConfigured(env)) return false;
  return (env.ENVIRONMENT ?? 'development') !== 'production';
}

export function clerkHost(publishableKey: string): string | null {
  const prefix = publishableKey.startsWith('pk_live_')
    ? 'pk_live_'
    : publishableKey.startsWith('pk_test_')
      ? 'pk_test_'
      : '';
  if (!prefix) return null;
  try {
    const decoded = atob(publishableKey.slice(prefix.length)).replace(
      /\$$/,
      '',
    );
    if (!decoded || decoded.includes('mock') || !decoded.includes('.'))
      return null;
    return decoded;
  } catch {
    return null;
  }
}
