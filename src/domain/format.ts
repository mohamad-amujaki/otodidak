export function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(iso));
}

export function formatWhenShort(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(iso));
}

export function minuteLabel(minutes: number): string {
  return `~${minutes} menit`;
}

/** 0 → A, 25 → Z, 26 → AA. Dipakai untuk menomori sub-bab, bukan bab. */
export function alphaLabel(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function quizStatusLabel(
  status: 'unchecked' | 'retry' | 'understood',
): string {
  switch (status) {
    case 'unchecked':
      return 'Belum dicek';
    case 'retry':
      return 'Perlu ulang';
    case 'understood':
      return 'Paham';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}
