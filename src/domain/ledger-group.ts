import { jakartaDate } from './time';

const monthFormatter = new Intl.DateTimeFormat('id-ID', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});

export function monthGroupKey(iso: string): string {
  return jakartaDate(new Date(iso)).slice(0, 7);
}

export function monthGroupLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return monthFormatter.format(new Date(Date.UTC(year, month - 1, 15)));
}

export function groupEntriesByMonth<T extends { createdAt: string }>(
  entries: T[],
): { key: string; label: string; entries: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = monthGroupKey(entry.createdAt);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: monthGroupLabel(key),
    entries: items,
  }));
}
