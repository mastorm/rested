export type Mode = 'study' | 'play';
export type Notice = 'budgetEmpty' | 'sleepPaused';

export interface DayTotals {
  date: string;
  studyMs: number;
  playMs: number;
}

export interface Session {
  id: number;
  mode: Mode;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  dayTotals?: Record<string, DayTotals> | null;
}

export interface SessionInput {
  mode: Mode;
  startedAt: number;
  durationMs: number;
}

export type SessionDialogRequest = { kind: 'add' | 'history' } | { kind: 'edit' | 'delete'; session: Session };

export interface Snapshot {
  revision: number;
  mode: Mode | null;
  balanceMs: number;
  today: DayTotals;
  studyMs: number;
  playMs: number;
  currentSessionMs: number;
  activeSessionId: number | null;
  sessionCount: number;
  sessions: Session[];
  week: DayTotals[];
  notice: Notice | null;
  notificationsEnabled: boolean;
  storageError: string | null;
}
