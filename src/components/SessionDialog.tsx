import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Pencil, Plus, Swords, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { timerClient } from '../lib/client';
import { clock, duration, sessionTime } from '../lib/format';
import { CORRECTION_ERROR, correctedBalance, datetimeLocal, exactDuration, parseDuration } from '../lib/sessionForm';
import type { Mode, Session, SessionDialogRequest, SessionInput, Snapshot } from '../lib/types';

interface Props {
  request: SessionDialogRequest;
  state: Snapshot;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (id: number | null, input: SessionInput) => Promise<boolean>;
  onDelete: (id: number) => Promise<boolean>;
  onPause: () => void;
  onClearError: () => void;
}

function SessionForm({ original, state, pending, onSubmit, onCancel }: {
  original: Session | null;
  state: Snapshot;
  pending: boolean;
  onSubmit: (input: SessionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>(original?.mode ?? 'study');
  const [started, setStarted] = useState(() => datetimeLocal(original?.startedAt ?? Date.now() - 25 * 60_000));
  const [elapsed, setElapsed] = useState(() => exactDuration(original?.durationMs ?? 25 * 60_000));
  const durationMs = parseDuration(elapsed);
  // Preserve original millisecond precision if the date field was not changed.
  const startedAt = original && started === datetimeLocal(original.startedAt) ? original.startedAt : new Date(started).getTime();
  const input = durationMs && Number.isFinite(startedAt) ? { mode, startedAt, durationMs } : null;
  const reserve = input ? correctedBalance(state, original, input) : null;
  const validation = !input ? 'Enter a valid start time and a duration such as 00:25:00.'
    : startedAt + input.durationMs > Date.now() ? 'The session must finish in the past. Check its start time and duration.'
      : reserve !== null && reserve < 0 ? CORRECTION_ERROR
        : original?.id === state.activeSessionId ? 'Pause this session before editing it.' : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (input && !validation && !pending) void onSubmit(input);
  }

  return <form className="session-form" onSubmit={submit}>
    <div className="form-field"><label htmlFor="session-mode">Activity</label><select id="session-mode" value={mode} onChange={event => setMode(event.target.value as Mode)} data-initial-focus><option value="study">Studying</option><option value="play">Playing WoW</option></select></div>
    <div className="form-field"><label htmlFor="session-start">Start date and time</label><input id="session-start" type="datetime-local" step="1" value={started} required onChange={event => setStarted(event.target.value)}/></div>
    <div className="form-field"><label htmlFor="session-duration">Duration</label><input id="session-duration" type="text" value={elapsed} required placeholder="00:25:00" spellCheck={false} aria-describedby="duration-help" onChange={event => setElapsed(event.target.value)}/><p id="duration-help">Hours : minutes : seconds. Example: 00:25:00.</p></div>
    <div className="correction-preview"><span>Reserve after saving</span><strong>{reserve !== null && reserve >= 0 ? clock(reserve) : '—'}</strong></div>
    <p className="correction-help">Changes update your reserve and daily totals. No timer is started.</p>
    {validation && <p className="form-error" role="status">{validation}</p>}
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={pending}>Cancel</button><button type="submit" className="primary-button" disabled={pending || Boolean(validation) || Boolean(state.storageError)}>{pending ? 'Saving…' : original ? 'Save changes' : 'Add session'}</button></div>
  </form>;
}

export function SessionDialog({ request, state, pending, error, onClose, onSave, onDelete, onPause, onClearError }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState(request);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const browse = request.kind === 'history';
  const title = view.kind === 'history' ? 'Session log' : view.kind === 'add' ? 'Add session' : view.kind === 'edit' ? 'Edit session' : 'Delete session';
  const original = 'session' in view ? view.session : null;
  const reserveAfterDelete = original ? correctedBalance(state, original, null) : 0;
  const canDelete = original && reserveAfterDelete >= 0 && original.id !== state.activeSessionId && !state.storageError;

  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  useEffect(() => { dialog.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus(); }, [view.kind]);
  useEffect(() => {
    if (view.kind !== 'history') return;
    let disposed = false;
    setLoading(true);
    setLoadError(null);
    void timerClient.listSessions().then(next => {
      if (!disposed) { setSessions(next); setPage(current => Math.min(current, Math.max(0, Math.ceil(next.length / 8) - 1))); }
    }).catch(cause => { if (!disposed) setLoadError(String(cause)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [view.kind, state.activeSessionId]);

  function changeView(next: SessionDialogRequest) { onClearError(); setView(next); }
  function dismiss() { if (!pending) { dialog.current?.close(); onClose(); } }
  function back() { if (browse) changeView({ kind: 'history' }); else dismiss(); }
  async function save(input: SessionInput) { if (await onSave(original?.id ?? null, input)) back(); }
  async function remove() { if (original && canDelete && await onDelete(original.id)) back(); }

  return <dialog className={`session-dialog metal-frame ${view.kind === 'history' ? 'history-dialog' : ''}`} ref={dialog} aria-labelledby="session-dialog-title" onCancel={event => { event.preventDefault(); dismiss(); }} onClose={onClose} onClick={event => {
    if (pending || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
  }}>
    <div className="session-dialog-heading">{browse && view.kind !== 'history' && <button className="icon-button" aria-label="Back to session log" onClick={back} disabled={pending}><ArrowLeft size={18}/></button>}<h2 id="session-dialog-title">{title}</h2><button className="icon-button" aria-label="Close session log" onClick={dismiss} disabled={pending}><X size={18}/></button></div>
    {(error || state.storageError || loadError) && <p className="form-error" role="alert">{error || state.storageError || loadError}</p>}
    {view.kind === 'history' ? <>
      <div className="history-toolbar"><p>{state.sessionCount} {state.sessionCount === 1 ? 'session' : 'sessions'} · newest first</p><button className="secondary-button" onClick={() => changeView({ kind: 'add' })} disabled={pending || Boolean(state.storageError)} data-initial-focus><Plus size={14}/>Add session</button></div>
      {state.activeSessionId !== null && <div className="history-running"><span>Pause the running session to edit or delete it.</span><button className="text-button" onClick={onPause} disabled={pending}>Pause timer</button></div>}
      {loading ? <p className="history-empty" role="status">Loading sessions…</p> : sessions.length ? <ul className="history-list">
        {sessions.slice(page * 8, page * 8 + 8).map(session => {
          const active = state.activeSessionId === session.id;
          const Icon = session.mode === 'study' ? BookOpen : Swords;
          const live = active ? state.sessions.find(s => s.id === session.id) ?? session : session;
          return <li key={session.id} className={session.mode}><span className="session-icon"><Icon size={17}/></span><div className="history-description"><strong>{session.mode === 'study' ? 'Studying' : 'Playing WoW'}{active && <small>Running</small>}</strong><span>{sessionTime(session.startedAt)}</span></div><span className="session-duration">{duration(live.durationMs)}</span><div className="session-row-actions"><button className="icon-button" aria-label={`Edit session ${session.id}`} title={active ? 'Pause this session to edit it' : 'Edit session'} disabled={active || pending || Boolean(state.storageError)} onClick={() => changeView({ kind: 'edit', session: live })}><Pencil size={14}/></button><button className="icon-button delete-icon" aria-label={`Delete session ${session.id}`} title={active ? 'Pause this session to delete it' : 'Delete session'} disabled={active || pending || Boolean(state.storageError)} onClick={() => changeView({ kind: 'delete', session: live })}><Trash2 size={14}/></button></div></li>;
        })}
      </ul> : <p className="history-empty">No sessions yet. Add an entry or start studying.</p>}
      {sessions.length > 8 && <div className="history-pagination"><button className="secondary-button" disabled={page === 0 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={14}/>Newer</button><span>Page {page + 1} of {Math.ceil(sessions.length / 8)}</span><button className="secondary-button" disabled={(page + 1) * 8 >= sessions.length || loading} onClick={() => setPage(page + 1)}>Older<ChevronRight size={14}/></button></div>}
    </> : view.kind === 'delete' && original ? <>
      <p className="delete-question">Delete this {original.mode === 'study' ? 'study' : 'WoW'} session?</p>
      <div className="delete-summary"><span>{sessionTime(original.startedAt)}</span><strong>{exactDuration(original.durationMs)}</strong></div>
      <p className="correction-help">{original.mode === 'study' ? `Removes ${duration(original.durationMs * 2)} of earned playtime.` : `Returns ${duration(original.durationMs)} to your reserve.`} This cannot be undone.</p>
      <div className="correction-preview"><span>Reserve after deleting</span><strong>{reserveAfterDelete >= 0 ? clock(reserveAfterDelete) : '—'}</strong></div>
      {reserveAfterDelete < 0 && <p className="form-error" role="status">{CORRECTION_ERROR}</p>}
      {original.id === state.activeSessionId && <p className="form-error">Pause this session before deleting it.</p>}
      <div className="dialog-actions"><button className="secondary-button" onClick={back} disabled={pending}>Cancel</button><button className="danger-button" disabled={!canDelete || pending} onClick={() => { void remove(); }}>{pending ? 'Deleting…' : 'Delete session'}</button></div>
    </> : <SessionForm key={`${view.kind}-${original?.id ?? 'new'}`} original={original} state={state} pending={pending} onSubmit={save} onCancel={back}/>}
  </dialog>;
}
