import { jakartaDate } from './time';

export type AdminTrendDay = {
  day: string;
  label: string;
  signups: number;
  revenueIdr: number;
};

export function jakartaDayKeysLast7(reference = new Date()): string[] {
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const t = reference.getTime() - i * 86_400_000;
    keys.push(jakartaDate(new Date(t)));
  }
  return keys;
}

export function jakartaDayStartIso(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00+07:00`).toISOString();
}

export function adminTrendDayLabel(dayKey: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(`${dayKey}T12:00:00+07:00`));
}

export function adminTrendAxisLabel(dayKey: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(`${dayKey}T12:00:00+07:00`));
}

export function mergeTrendRows(
  keys: string[],
  signupsByDay: Map<string, number>,
  revenueByDay: Map<string, number>,
): AdminTrendDay[] {
  return keys.map((day) => ({
    day,
    label: adminTrendDayLabel(day),
    signups: signupsByDay.get(day) ?? 0,
    revenueIdr: revenueByDay.get(day) ?? 0,
  }));
}

export function trendBarPercent(value: number, max: number): number {
  if (value <= 0) return 0;
  const scale = Math.max(max, 1);
  return Math.round((value / scale) * 100);
}
