export function requestAppOrigin(request: Request, env: Env): string {
  const configured = env.APP_ORIGIN?.trim().replace(/\/$/, '');
  const requestOrigin = new URL(request.url).origin;
  if (!configured || configured === 'http://localhost:8787')
    return requestOrigin;
  return configured;
}
