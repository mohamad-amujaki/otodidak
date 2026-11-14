/** Route bantu pengembangan; matikan di produksi lewat vars `ENVIRONMENT=production`. */
export function devRoutesEnabled(env: Env): boolean {
  const environment =
    (env as { ENVIRONMENT?: string }).ENVIRONMENT ?? 'development';
  return environment !== 'production';
}
