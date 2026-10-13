import { clock } from './format';
import type { Session, SessionInput, Snapshot } from './types';

export const CORRECTION_ERROR = 'This correction would leave more playtime recorded than earned. Add study time or reduce play entries first.';

export function datetimeLocal(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function exactDuration(ms: number): string {
  return clock(ms) + (ms % 1000 ? `.${String(ms % 1000).padStart(3, '0')}` : '');
}

export function parseDuration(value: string): number | null {
  const match = /^(\d{1,4}):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const ms = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000
    + Number((match[4] ?? '').padEnd(3, '0'));
  return ms > 0 && ms <= 366 * 24 * 60 * 60 * 1000 ? ms : null;
}

export function correctedBalance(state: Pick<Snapshot, 'studyMs' | 'playMs'>, original: Session | null, input: SessionInput | null): number {
  const study = state.studyMs - (original?.mode === 'study' ? original.durationMs : 0) + (input?.mode === 'study' ? input.durationMs : 0);
  const play = state.playMs - (original?.mode === 'play' ? original.durationMs : 0) + (input?.mode === 'play' ? input.durationMs : 0);
  return study * 2 - play;
}
