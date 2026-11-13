import { hmacSha256Base64, timingSafeEqual } from '../server/crypto';

const TOLERANCE_SECONDS = 5 * 60;

export async function verifySvix(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const svixId = headers.get('svix-id');
  const svixTimestamp = headers.get('svix-timestamp');
  const svixSignature = headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return false;
  const timestamp = Number(svixTimestamp);
  if (!Number.isFinite(timestamp)) return false;
  const now = Math.floor(nowMs / 1000);
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;
  const secretBase64 = secret.startsWith('whsec_')
    ? secret.slice('whsec_'.length)
    : secret;
  let secretBytes: Uint8Array;
  try {
    secretBytes = Uint8Array.from(atob(secretBase64), (char) =>
      char.charCodeAt(0),
    );
  } catch {
    return false;
  }
  const expected = await hmacSha256Base64(
    secretBytes,
    `${svixId}.${svixTimestamp}.${rawBody}`,
  );
  for (const entry of svixSignature.split(' ')) {
    const [version, ...rest] = entry.split(',');
    if (version !== 'v1') continue;
    const candidate = rest.join(',');
    if (timingSafeEqual(expected, candidate)) return true;
  }
  return false;
}

export async function signSvix(
  rawBody: string,
  secret: string,
  svixId: string,
  timestamp: number,
): Promise<string> {
  const secretBase64 = secret.startsWith('whsec_')
    ? secret.slice('whsec_'.length)
    : secret;
  const secretBytes = Uint8Array.from(atob(secretBase64), (char) =>
    char.charCodeAt(0),
  );
  const signature = await hmacSha256Base64(
    secretBytes,
    `${svixId}.${timestamp}.${rawBody}`,
  );
  return `v1,${signature}`;
}
