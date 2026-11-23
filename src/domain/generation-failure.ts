const FAILURE_MESSAGES: Record<string, string> = {
  provider_auth:
    'Kunci API penyedia ditolak. Admin perlu memperbarui secret lalu menguji koneksi.',
  provider_rate_limit:
    'Penyedia sedang membatasi permintaan. Tunggu sebentar lalu coba lagi.',
  provider_unavailable:
    'Penyedia sedang bermasalah atau menolak permintaan. Coba lagi beberapa saat lagi.',
  provider_network:
    'Server tidak bisa menghubungi penyedia. Periksa koneksi lalu coba lagi.',
  provider_timeout: 'Penyedia terlalu lama merespons. Coba lagi.',
  provider_request:
    'Penyedia menolak permintaan. Model atau parameter mungkin tidak didukung.',
  invalid_output:
    'Model tidak mengembalikan format yang diminta. Kredit sudah dikembalikan — coba lagi.',
  queue_stale:
    'Antrean tidak memproses pekerjaan ini. Kredit sudah dikembalikan — coba lagi.',
  queue_send_failed:
    'Antrean generasi gagal menerima pekerjaan ini. Kredit sudah dikembalikan.',
  generation_failed: 'Pembuatan gagal. Kredit sudah dikembalikan.',
  refunded: 'Pembuatan gagal. Kredit sudah dikembalikan.',
};

/** Pesan manusiawi untuk kode kegagalan generasi. */
export function generationFailureMessage(
  code: string | null | undefined,
): string {
  if (code && FAILURE_MESSAGES[code]) return FAILURE_MESSAGES[code];
  return 'Pembuatan gagal. Kredit sudah dikembalikan, silakan coba lagi.';
}

/** Apakah kode ini perlu tindakan admin (bukan sekadar coba ulang). */
export function generationFailureNeedsAdmin(
  code: string | null | undefined,
): boolean {
  return code === 'provider_auth' || code === 'provider_request';
}
