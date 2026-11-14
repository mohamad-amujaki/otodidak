export const ledgerReasonLabels: Record<string, string> = {
  signup_grant: 'Kredit awal',
  purchase: 'Pembelian',
  roadmap: 'Jalur',
  lesson: 'Pelajaran',
  quiz: 'Quiz',
  outline: 'Kerangka pelajaran',
  refund: 'Pengembalian',
  admin_adjust: 'Penyesuaian',
  redeem: 'Kode akses',
};

export const ledgerReasonIcons: Record<string, string> = {
  signup_grant: 'gift',
  purchase: 'shopping-bag',
  roadmap: 'map',
  lesson: 'book',
  quiz: 'brain',
  outline: 'sparkles',
  refund: 'arrow-left',
  admin_adjust: 'settings',
};

export const ledgerFilterOptions = [
  { value: '', label: 'Semua' },
  { value: 'purchase', label: 'Pembelian' },
  { value: 'usage', label: 'Pemakaian AI' },
  { value: 'signup_grant', label: 'Kredit awal' },
  { value: 'refund', label: 'Pengembalian' },
  { value: 'admin_adjust', label: 'Penyesuaian' },
  { value: 'redeem', label: 'Kode akses' },
] as const;

export const orderStatusLabels: Record<string, string> = {
  pending: 'Menunggu Pembayaran',
  paid: 'Berhasil',
  failed: 'Gagal',
  expired: 'Kedaluarsa',
};

export const orderFilterOptions = [
  { value: '', label: 'Semua' },
  { value: 'pending', label: 'Menunggu' },
  { value: 'paid', label: 'Berhasil' },
  { value: 'failed', label: 'Gagal' },
  { value: 'expired', label: 'Kadaluarsa' },
] as const;

export function shortOrderId(orderId: string): string {
  if (orderId.length <= 12) return orderId;
  return `${orderId.slice(0, 8)}…`;
}

export const creditTopUpHref = '/kredit#paket-kredit';

export const creditAlertTitle = 'Kredit tidak cukup';

export const creditReassurance = 'Materi yang sudah ada tetap bisa dibaca.';

export function hasEnoughCredits(balance: number, cost: number): boolean {
  return balance >= cost;
}

export function creditGap(balance: number, cost: number): number {
  return Math.max(0, cost - balance);
}

export function creditShortNote(balance: number, cost: number): string {
  return `Butuh ${cost} kredit · saldo kamu ${balance}`;
}

export function safeReturnPath(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

export function creditTopUpFor(returnPath: string | null): string {
  const safe = safeReturnPath(returnPath);
  if (!safe) return creditTopUpHref;
  return `/kredit?kembali=${encodeURIComponent(safe)}`;
}
