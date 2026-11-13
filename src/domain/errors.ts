export const errorCodes = [
  'insufficient_credits',
  'generation_in_progress',
  'generation_failed',
  'account_suspended',
  'rate_limited',
  'validation',
  'not_found',
  'forbidden',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorStatus: Record<ErrorCode, number> = {
  insufficient_credits: 402,
  generation_in_progress: 409,
  generation_failed: 409,
  account_suspended: 403,
  rate_limited: 429,
  validation: 400,
  not_found: 404,
  forbidden: 403,
};

export const errorMessage: Record<ErrorCode, string> = {
  insufficient_credits:
    'Saldo kredit habis. Materi yang sudah ada tetap bisa dibaca.',
  generation_in_progress: 'Masih disusun. Kamu bisa membaca yang sudah ada.',
  generation_failed:
    'Bagian ini belum selesai dibuat. Kredit untuk percobaan ini sudah dikembalikan.',
  account_suspended:
    'Akun ini ditahan. Materi yang sudah ada tetap bisa dibaca.',
  rate_limited: 'Terlalu banyak permintaan. Coba lagi sebentar.',
  validation: 'Periksa lagi isiannya.',
  not_found: 'Halaman ini tidak ada.',
  forbidden: 'Kamu tidak punya akses ke halaman ini.',
};

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message = errorMessage[code]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
