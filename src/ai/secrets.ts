type SecretReader = (env: Env) => string | undefined;

/**
 * Satu-satunya daftar nama secret yang bisa dipakai provider.
 * UI admin membaca daftar ini supaya tidak ada typo yang baru ketahuan saat generate.
 */
const SECRET_READERS: Record<string, SecretReader> = {
  OPENAI_API_KEY: (env) => env.OPENAI_API_KEY,
  YOUTUBE_API_KEY: (env) => env.YOUTUBE_API_KEY,
};

export type ProviderSecretOption = {
  name: string;
  configured: boolean;
};

export function readProviderSecret(
  env: Env,
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  return SECRET_READERS[name]?.(env) || null;
}

/** Nama valid + nilainya benar-benar terpasang di lingkungan Worker. */
export function isKnownProviderSecret(env: Env, name: string): boolean {
  if (!/^[A-Z0-9_]+$/.test(name)) return false;
  return Boolean(SECRET_READERS[name]?.(env));
}

export function providerSecretOptions(env: Env): ProviderSecretOption[] {
  return Object.entries(SECRET_READERS).map(([name, read]) => ({
    name,
    configured: Boolean(read(env)),
  }));
}

/** Secret palsu untuk mode dev/test — jangan sampai memicu request jaringan. */
export function isMockSecret(secret: string | null): boolean {
  return secret === 'mock' || secret === 'fail';
}
