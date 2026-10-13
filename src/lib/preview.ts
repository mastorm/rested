// Browser-only preview. The desktop app uses the Rust ledger, never this clock.
import { localDate } from './format';
import type { DayTotals, Mode, Notice, Session, SessionInput, Snapshot } from './types';
import { CORRECTION_ERROR } from './sessionForm';

export const PREVIEW_STORAGE_KEY = 'rested.preview.v1';

export interface PreviewData {
  version: 1;
  studyMs: number;
  playMs: number;
  days: Record<string, DayTotals>;
  sessions: Session[];
  nextId: number;
  notificationsEnabled: boolean;
}

export function emptyPreviewData(): PreviewData {
  return { version: 1, studyMs: 0, playMs: 0, days: {}, sessions: [], nextId: 1, notificationsEnabled: true };
}

export function parsePreviewData(raw: string): PreviewData {
  const data = JSON.parse(raw) as PreviewData;
  const validTime = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (data.version !== 1 || !validTime(data.studyMs) || !validTime(data.playMs)
    || data.playMs > data.studyMs * 2 || !data.days || !Array.isArray(data.sessions)
    || !validTime(data.nextId) || typeof data.notificationsEnabled !== 'boolean') {
    throw new Error('The saved browser preview is invalid. Your saved data has not been changed.');
  }
  const days = Object.entries(data.days);
  if (days.some(([date, day]) => day.date !== date || !validTime(day.studyMs) || !validTime(day.playMs))
    || days.reduce((sum, [, day]) => sum + day.studyMs, 0) !== data.studyMs
    || days.reduce((sum, [, day]) => sum + day.playMs, 0) !== data.playMs
    || data.sessions.some(session => !validTime(session.id) || !validTime(session.durationMs)
      || !['study', 'play'].includes(session.mode) || !Number.isFinite(session.startedAt)
      || !Number.isFinite(session.endedAt))) {
    throw new Error('The saved browser ledger is invalid. Your saved data has not been changed.');
  }
  return data;
}

export class PreviewEngine {
  mode: Mode | null = null;
  notice: Notice | null = null;
  revision = 0;
  activeSessionId: number | null = null;

  constructor(public data = emptyPreviewData()) {}

  get balanceMs() { return Math.max(0, this.data.studyMs * 2 - this.data.playMs); }

  start(mode: Mode, now: number) {
    if (this.mode === mode) return;
    if (mode === 'play' && this.balanceMs === 0) throw new Error('Study to earn some playtime first.');
    this.activeSessionId = this.data.nextId;
    this.data.sessions.push({ id: this.data.nextId++, mode, startedAt: now, endedAt: now, durationMs: 0, dayTotals: {} });
    if (this.data.sessions.length > 1000) this.data.sessions.shift();
    this.mode = mode;
    this.notice = null;
    this.revision++;
  }

  pause() {
    if (this.mode) { this.mode = null; this.activeSessionId = null; this.revision++; }
  }

  pauseForSleep() {
    if (this.mode) { this.pause(); this.notice = 'sleepPaused'; }
  }

  advance(elapsedMs: number, now: number) {
    if (!this.mode || elapsedMs <= 0) return;
    const mode = this.mode;
    const applied = mode === 'study' ? elapsedMs : Math.min(elapsedMs, this.balanceMs);
    this.data[mode === 'study' ? 'studyMs' : 'playMs'] += applied;
    const session = this.data.sessions.find(s => s.id === this.activeSessionId)!;
    const contributions = this.intervalDays(mode, now - elapsedMs, applied);
    this.applyDays(this.data.days, contributions);
    if (session.dayTotals) this.applyDays(session.dayTotals, contributions);
    session.durationMs += applied;
    session.endedAt = now - elapsedMs + applied;
    if (mode === 'play' && this.balanceMs === 0) { this.mode = null; this.activeSessionId = null; this.notice = 'budgetEmpty'; }
    this.revision++;
  }

  private intervalDays(mode: Mode, start: number, elapsed: number): Record<string, DayTotals> {
    const days: Record<string, DayTotals> = {};
    let remaining = elapsed;
    while (remaining > 0) {
      const current = new Date(start);
      const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
      const amount = Math.min(remaining, midnight - start);
      const date = localDate(current);
      const day = days[date] ??= { date, studyMs: 0, playMs: 0 };
      day[mode === 'study' ? 'studyMs' : 'playMs'] += amount;
      remaining -= amount;
      start += amount;
    }
    return days;
  }

  private applyDays(days: Record<string, DayTotals>, contributions: Record<string, DayTotals>, subtract = false) {
    for (const [date, amount] of Object.entries(contributions)) {
      const day = days[date] ??= { date, studyMs: 0, playMs: 0 };
      day.studyMs += amount.studyMs * (subtract ? -1 : 1);
      day.playMs += amount.playMs * (subtract ? -1 : 1);
      if (day.studyMs < 0 || day.playMs < 0) throw new Error('Cannot safely reconcile this session with its daily totals.');
    }
  }

  private sessionDays(data: PreviewData, session: Session): Record<string, DayTotals> {
    if (session.dayTotals) return session.dayTotals;
    const field = session.mode === 'study' ? 'studyMs' : 'playMs';
    const available = Object.fromEntries(Object.entries(data.days).map(([date, day]) => [date, day[field]]));
    for (const other of data.sessions) {
      if (other.id === session.id || !other.dayTotals) continue;
      for (const [date, day] of Object.entries(other.dayTotals)) available[date] = Math.max(0, (available[date] ?? 0) - day[field]);
    }
    const result: Record<string, DayTotals> = {};
    let remaining = session.durationMs;
    const allocate = (date: string, requested: number) => {
      const amount = Math.min(requested, available[date] ?? 0, remaining);
      available[date] = (available[date] ?? 0) - amount;
      remaining -= amount;
      (result[date] ??= { date, studyMs: 0, playMs: 0 })[field] += amount;
    };
    for (const [date, day] of Object.entries(this.intervalDays(session.mode, session.startedAt, session.durationMs))) allocate(date, day[field]);
    const distance = (date: string) => Math.abs(new Date(`${date}T12:00:00`).getTime() - session.startedAt);
    Object.keys(available).sort((a, b) => distance(a) - distance(b)).forEach(date => allocate(date, Number.MAX_SAFE_INTEGER));
    if (remaining) throw new Error('Cannot safely reconcile this older session with the saved ledger.');
    return result;
  }

  private removeCredit(data: PreviewData, session: Session) {
    this.applyDays(data.days, this.sessionDays(data, session), true);
    data[session.mode === 'study' ? 'studyMs' : 'playMs'] -= session.durationMs;
  }

  private finishCorrection(data: PreviewData) {
    if (data.playMs > data.studyMs * 2) throw new Error(CORRECTION_ERROR);
    parsePreviewData(JSON.stringify(data));
    this.data = data;
    this.revision++;
    if (this.mode === 'play' && this.balanceMs === 0) { this.pause(); this.notice = 'budgetEmpty'; }
    else if (this.balanceMs > 0 && this.notice === 'budgetEmpty') this.notice = null;
  }

  saveSession(id: number | null, input: SessionInput, now: number) {
    if (id !== null && id === this.activeSessionId) throw new Error('Pause this session before editing it.');
    if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0 || input.durationMs > 366 * 24 * 60 * 60 * 1000) throw new Error('Enter a duration greater than zero and no longer than one year.');
    if (!Number.isSafeInteger(input.startedAt) || !Number.isFinite(new Date(input.startedAt).getTime())) throw new Error('Enter a valid start date.');
    if (input.startedAt + input.durationMs > now) throw new Error('A manual session must finish in the past. Check its start time and duration.');
    const data = structuredClone(this.data);
    const position = id === null ? -1 : data.sessions.findIndex(s => s.id === id);
    if (id !== null && position === -1) throw new Error('This session no longer exists.');
    if (position !== -1) this.removeCredit(data, data.sessions[position]);
    const contributions = this.intervalDays(input.mode, input.startedAt, input.durationMs);
    this.applyDays(data.days, contributions);
    data[input.mode === 'study' ? 'studyMs' : 'playMs'] += input.durationMs;
    const session: Session = { id: id ?? data.nextId++, ...input, endedAt: input.startedAt + input.durationMs, dayTotals: contributions };
    if (position !== -1) data.sessions[position] = session;
    else {
      data.sessions.push(session);
      if (data.sessions.length > 1000) data.sessions.splice(data.sessions.findIndex(s => s.id !== this.activeSessionId), 1);
    }
    this.finishCorrection(data);
  }

  deleteSession(id: number) {
    if (id === this.activeSessionId) throw new Error('Pause this session before deleting it.');
    const data = structuredClone(this.data);
    const position = data.sessions.findIndex(s => s.id === id);
    if (position === -1) throw new Error('This session no longer exists.');
    this.removeCredit(data, data.sessions[position]);
    data.sessions.splice(position, 1);
    this.finishCorrection(data);
  }

  listSessions() {
    return this.data.sessions.map(s => ({ ...s })).sort((a, b) => b.startedAt - a.startedAt || b.id - a.id);
  }

  snapshot(now: number, storageError: string | null = null): Snapshot {
    const dayFor = (date: string) => ({ ...(this.data.days[date] ?? { date, studyMs: 0, playMs: 0 }) });
    const week = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(now);
      day.setDate(day.getDate() - 6 + i);
      return dayFor(localDate(day));
    });
    return {
      revision: this.revision,
      mode: this.mode,
      balanceMs: this.balanceMs,
      today: dayFor(localDate(new Date(now))),
      studyMs: this.data.studyMs,
      playMs: this.data.playMs,
      currentSessionMs: this.mode ? this.data.sessions.find(s => s.id === this.activeSessionId)?.durationMs ?? 0 : 0,
      activeSessionId: this.activeSessionId,
      sessionCount: this.data.sessions.length,
      sessions: this.listSessions().filter(s => s.durationMs > 0).slice(0, 6),
      week,
      notice: this.notice,
      notificationsEnabled: this.data.notificationsEnabled,
      storageError,
    };
  }
}

export class PreviewClock {
  private engine: PreviewEngine;
  private listeners = new Set<(state: Snapshot) => void>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastTick = performance.now();
  private lastWall = Date.now();
  private storageError: string | null = null;

  constructor() {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
    this.engine = new PreviewEngine(raw ? parsePreviewData(raw) : emptyPreviewData());
    window.addEventListener('pagehide', () => { this.settle(); this.engine.pause(); this.save(); });
  }

  private settle() {
    const instant = performance.now();
    const now = Date.now();
    const elapsed = Math.floor(instant - this.lastTick);
    if (elapsed > 5000 || now - this.lastWall > 5000) {
      this.engine.pauseForSleep();
      this.lastTick = instant;
    } else {
      this.engine.advance(elapsed, now);
      this.lastTick += elapsed;
    }
    this.lastWall = now;
  }

  private save() {
    try {
      localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(this.engine.data));
      this.storageError = null;
    } catch {
      this.engine.pause();
      this.storageError = 'Your timers are paused because this browser cannot save your progress.';
    }
  }

  private emit() {
    const state = this.engine.snapshot(Date.now(), this.storageError);
    this.listeners.forEach(listener => listener(state));
    return state;
  }

  async subscribe(listener: (state: Snapshot) => void) {
    this.listeners.add(listener);
    if (!this.interval) {
      this.lastTick = performance.now();
      this.lastWall = Date.now();
      this.interval = setInterval(() => { this.settle(); this.save(); this.emit(); }, 250);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.interval) { clearInterval(this.interval); this.interval = null; }
    };
  }

  async getState() { this.settle(); return this.emit(); }
  async start(mode: Mode) {
    this.settle();
    if (this.storageError) throw new Error(this.storageError);
    this.engine.start(mode, Date.now());
    this.save();
    return this.emit();
  }
  async pause() { this.settle(); this.engine.pause(); this.save(); return this.emit(); }
  async setNotifications(enabled: boolean) {
    this.engine.data.notificationsEnabled = enabled;
    this.engine.revision++;
    this.save();
    return this.emit();
  }

  async listSessions() { this.settle(); return this.engine.listSessions(); }

  private correct(operation: (engine: PreviewEngine) => void) {
    this.settle();
    if (this.storageError) throw new Error(this.storageError);
    const candidate = new PreviewEngine(structuredClone(this.engine.data));
    candidate.mode = this.engine.mode;
    candidate.activeSessionId = this.engine.activeSessionId;
    candidate.notice = this.engine.notice;
    candidate.revision = this.engine.revision;
    operation(candidate);
    try { localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(candidate.data)); }
    catch {
      this.engine.pause();
      this.storageError = 'Session changes were not saved. Your timers are paused.';
      this.emit();
      throw new Error(this.storageError);
    }
    this.engine = candidate;
    return this.emit();
  }

  async saveSession(id: number | null, input: SessionInput) { return this.correct(engine => engine.saveSession(id, input, Date.now())); }
  async deleteSession(id: number) { return this.correct(engine => engine.deleteSession(id)); }
}
