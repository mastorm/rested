import { BookOpen, Pencil, Plus, ScrollText, Swords, Trash2 } from 'lucide-react';
import { duration, sessionTime } from '../lib/format';
import type { SessionDialogRequest, Snapshot } from '../lib/types';

export function Activity({ state, pending, onSessions }: { state: Snapshot | null; pending: boolean; onSessions: (request: SessionDialogRequest) => void }) {
  const week = state?.week ?? [];
  const max = Math.max(60_000, ...week.flatMap(day => [day.studyMs, day.playMs]));
  const study = week.reduce((sum, day) => sum + day.studyMs, 0);
  const play = week.reduce((sum, day) => sum + day.playMs, 0);

  return (
    <div className="activity-grid">
      <section className="week-panel quiet-frame" aria-labelledby="week-heading">
        <div className="panel-heading"><h2 id="week-heading">Your week</h2><div className="chart-legend"><span><i className="study-dot"/>Study</span><span><i className="play-dot"/>Play</span></div></div>
        <div className="weekly-chart" role="img" aria-label={`Last seven days: ${duration(study)} studying, ${duration(play)} playing. ${week.map(d => `${d.date}: ${duration(d.studyMs)} study, ${duration(d.playMs)} play`).join('; ')}`}>
          <div className="chart-guides"><span/ ><span/ ><span/ ></div>
          {week.map((day, index) => {
            const weekday = new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' });
            return <div className={`chart-day ${index === 6 ? 'today' : ''}`} key={day.date} title={`${weekday}: ${duration(day.studyMs)} study · ${duration(day.playMs)} play`}>
              <div className="bar-pair"><div className="chart-bar study-bar" style={{ height: `${Math.max(day.studyMs ? 4 : 2, day.studyMs / max * 100)}%` }}/><div className="chart-bar play-bar" style={{ height: `${Math.max(day.playMs ? 4 : 2, day.playMs / max * 100)}%` }}/></div>
              <span>{index === 6 ? 'Today' : weekday}</span>
            </div>;
          })}
        </div>
        <div className="week-totals"><span><BookOpen size={13}/><strong>{duration(study)}</strong> studied</span><span><Swords size={13}/><strong>{duration(play)}</strong> played</span></div>
      </section>
      <section className="sessions-panel quiet-frame" aria-labelledby="sessions-heading">
        <div className="panel-heading"><h2 id="sessions-heading">Session log</h2><button className="icon-button" aria-label="Add session" title="Add a session" disabled={!state || pending || Boolean(state.storageError)} onClick={event => { event.currentTarget.focus(); onSessions({ kind: 'add' }); }}><Plus size={16}/></button></div>
        {state?.sessions.length ? <ul className="sessions-list">
          {state.sessions.slice(0, 4).map(session => {
            const Icon = session.mode === 'study' ? BookOpen : Swords;
            return <li key={session.id} className={session.mode}>
              <span className="session-icon"><Icon size={16} strokeWidth={1.4}/></span>
              <div><strong>{session.mode === 'study' ? 'Studying' : 'Playing WoW'}</strong><span>{sessionTime(session.startedAt)}</span></div>
              <span className="session-duration">{duration(session.durationMs)}</span>
              <div className="session-row-actions"><button className="icon-button" aria-label={`Edit session ${session.id}`} title={state.activeSessionId === session.id ? 'Pause this session to edit it' : 'Edit session'} disabled={state.activeSessionId === session.id || pending || Boolean(state.storageError)} onClick={event => { event.currentTarget.focus(); onSessions({ kind: 'edit', session }); }}><Pencil size={12}/></button><button className="icon-button delete-icon" aria-label={`Delete session ${session.id}`} title={state.activeSessionId === session.id ? 'Pause this session to delete it' : 'Delete session'} disabled={state.activeSessionId === session.id || pending || Boolean(state.storageError)} onClick={event => { event.currentTarget.focus(); onSessions({ kind: 'delete', session }); }}><Trash2 size={12}/></button></div>
              {state.activeSessionId === session.id && <span className="session-live" aria-label="Active session"/>}
            </li>;
          })}
        </ul> : <div className="empty-sessions"><ScrollText size={26} strokeWidth={1}/><p>No sessions yet</p><span>Start studying to earn your first playtime.</span></div>}
        {Boolean(state?.sessionCount) && <button className="view-sessions text-button" onClick={event => { event.currentTarget.focus(); onSessions({ kind: 'history' }); }}>View all {state?.sessionCount} sessions</button>}
      </section>
    </div>
  );
}
