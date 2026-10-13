import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { PreviewClock } from './preview';
import type { Mode, Session, SessionInput, Snapshot } from './types';

export const native = isTauri();
let preview: PreviewClock | undefined;
const browser = () => preview ??= new PreviewClock();

export const timerClient = {
  subscribe: (listener: (state: Snapshot) => void) => native
    ? listen<Snapshot>('timer-state', event => listener(event.payload))
    : browser().subscribe(listener),
  getState: () => native ? invoke<Snapshot>('get_state') : browser().getState(),
  start: (mode: Mode) => native ? invoke<Snapshot>('start_timer', { mode }) : browser().start(mode),
  pause: () => native ? invoke<Snapshot>('pause_timer') : browser().pause(),
  setNotifications: (enabled: boolean) => native
    ? invoke<Snapshot>('set_notifications', { enabled }) : browser().setNotifications(enabled),
  listSessions: () => native ? invoke<Session[]>('list_sessions') : browser().listSessions(),
  saveSession: (id: number | null, input: SessionInput) => native
    ? invoke<Snapshot>('save_session', { id, input }) : browser().saveSession(id, input),
  deleteSession: (id: number) => native
    ? invoke<Snapshot>('delete_session', { id }) : browser().deleteSession(id),
};

export async function notificationPermission(): Promise<boolean> {
  if (!native) return false;
  return await isPermissionGranted() || await requestPermission() === 'granted';
}
