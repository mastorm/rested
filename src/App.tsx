import { Check, CircleHelp, Settings2, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Activity } from './components/Activity';
import { Sigil } from './components/Artwork';
import { Preferences } from './components/Preferences';
import { Reserve } from './components/Reserve';
import { TimerCard } from './components/TimerCard';
import { SessionDialog } from './components/SessionDialog';
import { native } from './lib/client';
import { useTimer } from './lib/useTimer';
import type { SessionDialogRequest } from './lib/types';

export default function App() {
  const timer = useTimer();
  const [preferences, setPreferences] = useState(false);
  const [sessionDialog, setSessionDialog] = useState<SessionDialogRequest | null>(null);
  const { state, toggle, pause } = timer;

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (preferences || sessionDialog || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); toggle('study'); }
      if (event.key.toLowerCase() === 'w' && (state?.balanceMs ?? 0) > 0) { event.preventDefault(); toggle('play'); }
      if (event.code === 'Space' && state?.mode && target.tagName !== 'BUTTON') { event.preventDefault(); pause(); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [toggle, pause, state?.mode, state?.balanceMs, preferences, sessionDialog]);

  function openSessions(request: SessionDialogRequest) { timer.clearError(); setSessionDialog(request); }

  return (
    <div className="app-shell">
      <header className={`titlebar ${native ? 'native-titlebar' : ''}`} onMouseDown={event => {
        if (!native || event.button !== 0 || (event.target as Element).closest('button, input, a')) return;
        event.preventDefault();
        void getCurrentWindow().startDragging().catch(cause => timer.reportError(`Could not move the window: ${String(cause)}`));
      }}>
        {!native && <span className="preview-label">Browser preview</span>}
        <div className="titlebar-wordmark"><span/>R E S T E D<span/></div>
        <button className="icon-button" aria-label="Open preferences" title="Preferences" onClick={event => { event.currentTarget.focus(); setPreferences(true); }}><Settings2 size={17} strokeWidth={1.5}/></button>
      </header>
      <main>
        <div className="masthead">
          <div className="brand"><Sigil className="brand-sigil"/><div><h1>Rested</h1><p>Earn your adventures.</p></div></div>
          <div className="pact"><span>Study</span><strong>1 <span>:</span> 2</strong><span>Play</span></div>
        </div>
        <Reserve state={state}/>
        <div className="timers-grid"><TimerCard mode="study" state={state} pending={timer.pending} onToggle={toggle}/><TimerCard mode="play" state={state} pending={timer.pending} onToggle={toggle}/></div>
        <div className="notice-space" aria-live="polite" aria-atomic="true">
          {state?.notice === 'budgetEmpty' ? <p className="notice budget-notice"><CircleHelp size={15}/><span>Your reserve is empty. Time for a study break—your play timer has stopped.</span></p>
            : state?.notice === 'sleepPaused' ? <p className="notice"><ShieldCheck size={15}/><span>Your timer paused while your Mac rested. Start it again when you’re ready.</span></p>
              : <p className="quiet-note"><span className="tiny-diamond"/>Focus first. Adventure follows.<span className="tiny-diamond"/></p>}
        </div>
        {(timer.error || state?.storageError) && <div className="error-banner" role="alert"><span>{timer.error || state?.storageError}</span>{timer.error && state && <button className="icon-button" aria-label="Dismiss error" onClick={timer.clearError}><X size={15}/></button>}</div>}
        <Activity state={state} pending={timer.pending} onSessions={openSessions}/>
        <footer className="app-footer"><span className="save-status"><Check size={13}/>{state?.storageError ? 'Saving unavailable' : native ? 'Saved on this Mac' : 'Saved in this browser'}</span><span className="keyboard-hint"><kbd>S</kbd> Study <span>·</span> <kbd>W</kbd> Play <span>·</span> <kbd>Space</kbd> Pause</span><button onClick={event => { event.currentTarget.focus(); setPreferences(true); }}>Your pact <CircleHelp size={13}/></button></footer>
      </main>
      <Preferences open={preferences} onClose={() => setPreferences(false)} state={state} pending={timer.pending} onNotifications={timer.setNotifications}/>
      {sessionDialog && state && <SessionDialog request={sessionDialog} state={state} pending={timer.pending} error={timer.error} onClose={() => { setSessionDialog(null); timer.clearError(); }} onSave={timer.saveSession} onDelete={timer.deleteSession} onPause={timer.pause} onClearError={timer.clearError}/>}
    </div>
  );
}
