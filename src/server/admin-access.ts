function parseList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperadmin(env: Env, email: string): boolean {
  const list = parseList(env.SUPERADMIN_EMAILS);
  const allowed =
    list.length > 0 ? list : [env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()];
  return allowed.includes(email.toLowerCase());
}
