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
  return `Sekitar ${minutes} menit`;
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
