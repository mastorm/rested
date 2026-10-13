import { describe, expect, it } from 'vitest';
import { correctedBalance, datetimeLocal, exactDuration, parseDuration } from './sessionForm';

describe('session form', () => {
  it('round trips durations without silently losing sub-second credit', () => {
    expect(exactDuration(60_123)).toBe('00:01:00.123');
    expect(parseDuration(exactDuration(60_123))).toBe(60_123);
    expect(parseDuration('100:25:59.1')).toBe((100 * 3600 + 25 * 60 + 59) * 1000 + 100);
    for (const value of ['', '25m', '00:60:00', '00:00:00', '-01:00:00', '9999:00:00']) expect(parseDuration(value)).toBeNull();
  });
  it('formats a local datetime rather than a UTC input value', () => {
    expect(datetimeLocal(new Date(2026, 9, 13, 12, 34, 56).getTime())).toBe('2026-10-13T12:34:56');
  });
  it('previews additions, edits, mode changes, and deletion accurately', () => {
    const state = { studyMs: 60_000, playMs: 30_000 };
    const session = { id: 1, mode: 'study' as const, startedAt: 0, endedAt: 60_000, durationMs: 60_000 };
    expect(correctedBalance(state, null, { mode: 'study', startedAt: 0, durationMs: 60_000 })).toBe(210_000);
    expect(correctedBalance(state, session, { mode: 'study', startedAt: 0, durationMs: 30_000 })).toBe(30_000);
    expect(correctedBalance(state, session, { mode: 'play', startedAt: 0, durationMs: 30_000 })).toBe(-60_000);
    expect(correctedBalance(state, session, null)).toBe(-30_000);
  });
});
