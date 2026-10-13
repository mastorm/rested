import { describe, expect, it } from 'vitest';
import { PreviewEngine, emptyPreviewData, parsePreviewData } from './preview';

const now = new Date(2026, 9, 13, 12).getTime();

describe('browser preview ledger', () => {
  it('earns at 2x, switches exclusively, and stops at zero without debt', () => {
    const engine = new PreviewEngine();
    expect(() => engine.start('play', now)).toThrow();
    engine.start('study', now);
    engine.advance(60_000, now + 60_000);
    expect(engine.balanceMs).toBe(120_000);
    engine.start('play', now + 60_000);
    engine.advance(150_000, now + 210_000);
    expect(engine.balanceMs).toBe(0);
    expect(engine.data.playMs).toBe(120_000);
    expect(engine.data.studyMs).toBe(60_000);
    expect(engine.mode).toBeNull();
    expect(engine.notice).toBe('budgetEmpty');
    expect(parsePreviewData(JSON.stringify(engine.data))).toEqual(engine.data);
  });

  it('reopens paused and preserves the earned reserve', () => {
    const engine = new PreviewEngine();
    engine.start('study', now);
    engine.advance(5000, now + 5000);
    const restored = new PreviewEngine(parsePreviewData(JSON.stringify(engine.data)));
    restored.advance(60_000, now + 65_000);
    expect(restored.mode).toBeNull();
    expect(restored.balanceMs).toBe(10_000);
  });

  it('does not credit paused or sleeping time', () => {
    const engine = new PreviewEngine();
    engine.start('study', now);
    engine.advance(1000, now + 1000);
    engine.pauseForSleep();
    engine.advance(60_000, now + 61_000);
    expect(engine.balanceMs).toBe(2000);
    expect(engine.notice).toBe('sleepPaused');
  });

  it('splits a session at local midnight without resetting the balance', () => {
    const engine = new PreviewEngine();
    const start = new Date(2026, 9, 13, 23, 59, 59).getTime();
    engine.start('study', start);
    engine.advance(2000, start + 2000);
    expect(engine.data.days['2026-10-13'].studyMs).toBe(1000);
    expect(engine.data.days['2026-10-14'].studyMs).toBe(1000);
    expect(engine.balanceMs).toBe(4000);
  });

  it('refuses corrupted data rather than overwriting it', () => {
    expect(() => parsePreviewData('{')).toThrow();
    expect(() => parsePreviewData(JSON.stringify({ ...emptyPreviewData(), playMs: 1 }))).toThrow();
    expect(() => parsePreviewData(JSON.stringify({ ...emptyPreviewData(), studyMs: 1000 }))).toThrow();
  });

  it('adds, edits, changes mode, and deletes entries while recalculating totals', () => {
    const engine = new PreviewEngine();
    const input = { mode: 'study' as const, startedAt: now - 120_000, durationMs: 60_000 };
    engine.saveSession(null, input, now);
    expect(engine.balanceMs).toBe(120_000);
    engine.saveSession(1, { ...input, durationMs: 30_000 }, now);
    expect(engine.balanceMs).toBe(60_000);
    engine.saveSession(null, { ...input, startedAt: now - 300_000 }, now);
    engine.saveSession(1, { ...input, mode: 'play', durationMs: 30_000 }, now);
    expect(engine.balanceMs).toBe(90_000);
    engine.deleteSession(1);
    expect(engine.balanceMs).toBe(120_000);
    engine.deleteSession(2);
    expect(engine.balanceMs).toBe(0);
    expect(engine.data.sessions).toHaveLength(0);
    expect(parsePreviewData(JSON.stringify(engine.data))).toEqual(engine.data);
  });

  it('rejects unfunded corrections without changing any entries', () => {
    const engine = new PreviewEngine();
    engine.saveSession(null, { mode: 'study', startedAt: now - 120_000, durationMs: 60_000 }, now);
    engine.saveSession(null, { mode: 'play', startedAt: now - 60_000, durationMs: 30_000 }, now);
    const before = JSON.stringify(engine.data);
    expect(() => engine.deleteSession(1)).toThrow('more playtime recorded than earned');
    expect(() => engine.saveSession(1, { mode: 'study', startedAt: now - 120_000, durationMs: 1000 }, now)).toThrow();
    expect(JSON.stringify(engine.data)).toBe(before);
  });

  it('keeps the live session identity when adding or editing other entries', () => {
    const engine = new PreviewEngine();
    engine.start('study', now);
    engine.advance(1000, now + 1000);
    engine.saveSession(null, { mode: 'study', startedAt: now - 120_000, durationMs: 60_000 }, now + 1000);
    engine.advance(1000, now + 2000);
    expect(engine.data.sessions[0].durationMs).toBe(2000);
    expect(engine.data.sessions[1].durationMs).toBe(60_000);
    expect(engine.snapshot(now).activeSessionId).toBe(1);
    expect(() => engine.deleteSession(1)).toThrow('Pause');
    expect(() => engine.saveSession(1, { mode: 'study', startedAt: now - 120_000, durationMs: 60_000 }, now + 2000)).toThrow('Pause');
  });

  it('reconciles legacy entries without losing archived totals', () => {
    const engine = new PreviewEngine();
    engine.saveSession(null, { mode: 'study', startedAt: now - 120_000, durationMs: 60_000 }, now);
    const legacy = structuredClone(engine.data);
    delete legacy.sessions[0].dayTotals;
    const day = legacy.days['2026-10-13'];
    legacy.studyMs += 5000;
    day.studyMs += 5000;
    const restored = new PreviewEngine(parsePreviewData(JSON.stringify(legacy)));
    restored.deleteSession(1);
    expect(restored.data.studyMs).toBe(5000);
    expect(restored.balanceMs).toBe(10_000);
  });

  it('splits manual sessions over midnight and removes their exact contributions', () => {
    const engine = new PreviewEngine();
    const start = new Date(2026, 9, 12, 23, 59, 59).getTime();
    engine.saveSession(null, { mode: 'study', startedAt: start, durationMs: 2000 }, now);
    expect(engine.data.days['2026-10-12'].studyMs).toBe(1000);
    expect(engine.data.days['2026-10-13'].studyMs).toBe(1000);
    engine.saveSession(1, { mode: 'study', startedAt: start - 60_000, durationMs: 2000 }, now);
    expect(engine.data.days['2026-10-13'].studyMs).toBe(0);
    engine.deleteSession(1);
    expect(engine.data.days['2026-10-12'].studyMs).toBe(0);
  });
});
