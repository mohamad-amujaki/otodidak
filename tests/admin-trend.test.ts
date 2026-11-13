import { describe, expect, it } from 'vitest';
import {
  jakartaDayKeysLast7,
  mergeTrendRows,
  trendBarPercent,
} from '../src/domain/admin-trend';

describe('admin trend helpers', () => {
  it('builds 7 jakarta day keys', () => {
    const keys = jakartaDayKeysLast7(new Date('2026-11-13T12:00:00+07:00'));
    expect(keys).toHaveLength(7);
    expect(keys[6]).toBe('2026-11-13');
    expect(keys[0]).toBe('2026-11-07');
  });

  it('merges sparse counts into full week', () => {
    const keys = ['2026-11-10', '2026-11-11', '2026-11-12'];
    const signups = new Map([['2026-11-11', 3]]);
    const revenue = new Map([['2026-11-12', 50000]]);
    const rows = mergeTrendRows(keys, signups, revenue);
    expect(rows[0]?.signups).toBe(0);
    expect(rows[1]?.signups).toBe(3);
    expect(rows[2]?.revenueIdr).toBe(50000);
  });

  it('scales bar height', () => {
    expect(trendBarPercent(0, 10)).toBe(0);
    expect(trendBarPercent(5, 10)).toBe(50);
    expect(trendBarPercent(1, 0)).toBe(100);
  });
});
