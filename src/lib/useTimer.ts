import { useCallback, useEffect, useRef, useState } from 'react';
import { native, notificationPermission, timerClient } from './client';
import type { Mode, SessionInput, Snapshot } from './types';

export function useTimer() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const stateRef = useRef<Snapshot | null>(null);
  const pendingRef = useRef(false);

  const accept = useCallback((next: Snapshot) => {
    if (!stateRef.current || next.revision >= stateRef.current.revision) {
      stateRef.current = next;
      setState(next);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const receive = (next: Snapshot) => { if (!disposed) accept(next); };
    void (async () => {
      try {
        const stop = await timerClient.subscribe(receive);
        if (disposed) { stop(); return; }
        unsubscribe = stop;
        receive(await timerClient.getState());
      } catch (cause) {
        if (!disposed) setError(String(cause instanceof Error ? cause.message : cause));
      }
    })();
    return () => { disposed = true; unsubscribe?.(); };
  }, [accept]);

  const run = useCallback(async (operation: () => Promise<Snapshot>) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const next = await operation();
      accept(next);
      if (next.storageError) { setError(next.storageError); return false; }
      return true;
    }
    catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); return false; }
    finally { pendingRef.current = false; setPending(false); }
  }, [accept]);

  const toggle = useCallback((mode: Mode) => {
    const current = stateRef.current;
    if (!current) return;
    const alreadyActive = current.mode === mode;
    void run(() => alreadyActive ? timerClient.pause() : timerClient.start(mode));
    if (!alreadyActive && mode === 'play' && current.notificationsEnabled && native) {
      void notificationPermission().catch(() => {});
    }
  }, [run]);

  const pause = useCallback(() => { void run(() => timerClient.pause()); }, [run]);

  const setNotifications = useCallback(async (enabled: boolean) => {
    if (enabled && !await notificationPermission()) {
      setError('Notifications are blocked. Enable Rested in System Settings → Notifications, then try again.');
      return;
    }
    await run(() => timerClient.setNotifications(enabled));
  }, [run]);

  const saveSession = useCallback((id: number | null, input: SessionInput) => run(() => timerClient.saveSession(id, input)), [run]);
  const deleteSession = useCallback((id: number) => run(() => timerClient.deleteSession(id)), [run]);

  return { state, error, pending, toggle, pause, setNotifications, saveSession, deleteSession, reportError: setError, clearError: () => setError(null) };
}
