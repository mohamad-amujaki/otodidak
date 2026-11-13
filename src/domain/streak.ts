import { daysBetween, isoWeekKey } from './time';

export type StreakState = {
  enabled: boolean;
  count: number;
  lastDate: string | null;
  freezeWeek: string | null;
};

export type StreakResult = {
  count: number;
  lastDate: string | null;
  freezeWeek: string | null;
  changed: boolean;
  freezeUsedNow: boolean;
  restarted: boolean;
};

export function applyStreak(state: StreakState, today: string): StreakResult {
  const unchanged: StreakResult = {
    count: state.count,
    lastDate: state.lastDate,
    freezeWeek: state.freezeWeek,
    changed: false,
    freezeUsedNow: false,
    restarted: false,
  };
  if (!state.enabled) return unchanged;
  if (state.lastDate === today) return unchanged;
  if (!state.lastDate) {
    return {
      count: 1,
      lastDate: today,
      freezeWeek: state.freezeWeek,
      changed: true,
      freezeUsedNow: false,
      restarted: false,
    };
  }
  const gap = daysBetween(state.lastDate, today);
  if (gap <= 0) return unchanged;
  if (gap === 1) {
    return {
      count: state.count + 1,
      lastDate: today,
      freezeWeek: state.freezeWeek,
      changed: true,
      freezeUsedNow: false,
      restarted: false,
    };
  }
  const missed = gap - 1;
  const week = isoWeekKey(today);
  if (missed === 1 && state.freezeWeek !== week) {
    return {
      count: state.count + 1,
      lastDate: today,
      freezeWeek: week,
      changed: true,
      freezeUsedNow: true,
      restarted: false,
    };
  }
  return {
    count: 1,
    lastDate: today,
    freezeWeek: state.freezeWeek,
    changed: true,
    freezeUsedNow: false,
    restarted: true,
  };
}

export function streakSentences(input: {
  enabled: boolean;
  count: number;
  lastDate: string | null;
  freezeWeek: string | null;
  today: string;
  hasEarlierCompletion: boolean;
}): string[] {
  if (!input.enabled) return [];
  const lines = [`${input.count} hari`];
  if (input.freezeWeek && input.freezeWeek === isoWeekKey(input.today)) {
    lines.push('Jeda minggu ini terpakai.');
  }
  if (
    input.count === 1 &&
    input.lastDate === input.today &&
    input.hasEarlierCompletion
  ) {
    lines.push('Hitungan hari mulai lagi dari 1. Jalurmu tetap di tempat.');
  }
  return lines;
}
