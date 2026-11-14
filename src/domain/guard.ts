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
