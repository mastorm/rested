import { describe, expect, it } from 'vitest';
import { clock, duration, localDate, reserveScale } from './format';

describe('time formatting', () => {
  it('formats whole seconds without wrapping hours', () => {
    expect(clock(3_661_999)).toBe('01:01:01');
    expect(clock(100 * 3_600_000)).toBe('100:00:00');
    expect(clock(-5)).toBe('00:00:00');
  });
  it('formats short, readable durations', () => {
    expect(duration(0)).toBe('0m');
    expect(duration(500)).toBe('1s');
    expect(duration(95_000)).toBe('1m');
    expect(duration(3_600_000)).toBe('1h');
    expect(duration(5_400_000)).toBe('1h 30m');
  });
  it('uses calendar dates in the local timezone', () => {
    expect(localDate(new Date(2026, 9, 13, 23, 50))).toBe('2026-10-13');
  });
  it('extends the reserve scale rather than capping earned time', () => {
    expect(reserveScale(0)).toBe(7_200_000);
    expect(reserveScale(8_000_000)).toBe(14_400_000);
  });
});
