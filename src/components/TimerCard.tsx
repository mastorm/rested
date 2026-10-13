import { BookOpen, Pause, Play, Swords } from 'lucide-react';
import { clock } from '../lib/format';
import type { Mode, Snapshot } from '../lib/types';

interface Props {
  mode: Mode;
  state: Snapshot | null;
  pending: boolean;
  onToggle: (mode: Mode) => void;
}

export function TimerCard({ mode, state, pending, onToggle }: Props) {
  const study = mode === 'study';
  const active = state?.mode === mode;
  const Icon = study ? BookOpen : Swords;
  const disabled = !state || pending || Boolean(state.storageError) || (!study && state.balanceMs === 0);
  const elapsed = study ? state?.today.studyMs ?? 0 : state?.today.playMs ?? 0;

  return (
    <section className={`timer-card metal-frame ${mode} ${active ? 'is-active' : ''}`} aria-labelledby={`${mode}-title`}>
      <span className="corner corner-tl"/><span className="corner corner-tr"/><span className="corner corner-bl"/><span className="corner corner-br"/>
      <div className="card-heading">
        <div className="class-icon"><Icon size={25} strokeWidth={1.35}/></div>
        <div><h2 id={`${mode}-title`}>{study ? 'Study' : 'Azeroth'}</h2><p>{study ? 'Build your reserve' : 'Spend it on adventure'}</p></div>
        <span className={`activity-badge ${active ? 'live' : ''}`}><i/>{active ? (study ? 'Earning' : 'Playing') : 'Paused'}</span>
      </div>
      <div className="timer-face">
        <span className="eyebrow">{study ? 'Time studied today' : 'Time played today'}</span>
        <div className="clock" data-testid={`${mode}-clock`} aria-label={`${study ? 'Studied' : 'Played'} ${clock(elapsed)} today`}>{clock(elapsed)}</div>
        <div className="session-caption">{active ? <>Current session <span className="tiny-diamond"/> {clock(state?.currentSessionMs ?? 0)}</> : <><span className="thin-rule"/>{study ? 'A little focus. A little freedom.' : 'Your next quest can wait.'}<span className="thin-rule"/></>}</div>
      </div>
      <button
        className={`timer-button ${study ? 'blue-button' : 'gold-button'}`}
        onClick={() => onToggle(mode)}
        disabled={disabled}
        aria-keyshortcuts={study ? 'S' : 'W'}
        title={!study && state?.balanceMs === 0 ? 'Study first to earn playtime' : undefined}
      >
        {active ? <Pause size={16} fill="currentColor" strokeWidth={0}/> : <Play size={15} fill="currentColor" strokeWidth={0}/>}
        <span>{active ? (study ? 'Pause studying' : 'Pause playing') : (study ? 'Start studying' : 'Start playing')}</span>
        <kbd>{study ? 'S' : 'W'}</kbd>
      </button>
      <div className="conversion-note">{study ? <><span>+2 min</span> playtime / minute studied</> : state?.balanceMs === 0 ? <>Study to unlock your next adventure</> : <><span>−1 min</span> reserve / minute played</>}</div>
    </section>
  );
}
