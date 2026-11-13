import { describe, expect, it } from 'vitest';
import { applyStreak } from '../src/domain/streak';
import { isoWeekKey } from '../src/domain/time';

describe('hitungan hari', () => {
  it('tidak berubah saat dimatikan', () => {
    const result = applyStreak(
      { enabled: false, count: 4, lastDate: '2026-11-10', freezeWeek: null },
      '2026-11-13',
    );
    expect(result.changed).toBe(false);
    expect(result.count).toBe(4);
  });

  it('naik satu hari saat jaraknya satu hari', () => {
    const result = applyStreak(
      { enabled: true, count: 2, lastDate: '2026-11-12', freezeWeek: null },
      '2026-11-13',
    );
    expect(result.count).toBe(3);
    expect(result.freezeUsedNow).toBe(false);
  });

  it('memakai jeda sekali untuk satu hari yang terlewat dalam pekan ISO yang sama', () => {
    const today = '2026-11-12';
    const first = applyStreak(
      { enabled: true, count: 3, lastDate: '2026-11-10', freezeWeek: null },
      today,
    );
    expect(first.count).toBe(4);
    expect(first.freezeUsedNow).toBe(true);
    expect(first.freezeWeek).toBe(isoWeekKey(today));
    const second = applyStreak(
      {
        enabled: true,
        count: first.count,
        lastDate: first.lastDate,
        freezeWeek: first.freezeWeek,
      },
      '2026-11-14',
    );
    expect(second.count).toBe(1);
    expect(second.freezeUsedNow).toBe(false);
    expect(second.restarted).toBe(true);
  });

  it('mengulang dari 1 jika lebih dari satu hari terlewat', () => {
    const result = applyStreak(
      { enabled: true, count: 6, lastDate: '2026-11-10', freezeWeek: null },
      '2026-11-13',
    );
    expect(result.count).toBe(1);
    expect(result.restarted).toBe(true);
  });
});
