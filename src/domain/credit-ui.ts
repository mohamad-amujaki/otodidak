export const ledgerReasonLabels: Record<string, string> = {
  signup_grant: 'Kredit awal',
  purchase: 'Pembelian',
  roadmap: 'Jalur',
  lesson: 'Pelajaran',
  quiz: 'Kuis',
  outline: 'Kerangka pelajaran',
  refund: 'Pengembalian',
  admin_adjust: 'Penyesuaian',
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
