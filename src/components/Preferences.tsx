import { Bell, BookOpen, HardDrive, Moon, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { native } from '../lib/client';
import type { Snapshot } from '../lib/types';
import { Sigil } from './Artwork';

interface Props {
  open: boolean;
  onClose: () => void;
  state: Snapshot | null;
  pending: boolean;
  onNotifications: (enabled: boolean) => Promise<void>;
}

export function Preferences({ open, onClose, state, pending, onNotifications }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);

  return (
    <dialog className="preferences metal-frame" ref={dialog} aria-labelledby="preferences-heading" onCancel={onClose} onClose={onClose} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
      <div className="preferences-heading"><Sigil/><h2 id="preferences-heading">Preferences</h2><button className="icon-button" aria-label="Close preferences" onClick={onClose}><X size={19}/></button></div>
      <div className="preference-row"><Bell size={20}/><div><label htmlFor="notifications">Reserve notifications</label><p>{native ? 'Notify me when my playtime runs out.' : 'Available in the native desktop app.'}</p></div><input id="notifications" className="toggle" type="checkbox" role="switch" checked={state?.notificationsEnabled ?? true} disabled={!native || pending || !state} onChange={event => { void onNotifications(event.target.checked); }}/></div>
      <div className="preference-info"><BookOpen size={19}/><div><h3>Your pact with Azeroth</h3><p>One minute of studying earns two minutes of playtime. Only one timer runs at a time. At zero, your play timer stops—not your game.</p></div></div>
      <div className="preference-info"><Moon size={19}/><div><h3>Rest means rest</h3><p>Timers pause when your Mac sleeps or the app quits. Your reserve carries over, and timers reopen paused.</p></div></div>
      <div className="preference-info"><HardDrive size={19}/><div><h3>Just you and your ledger</h3><p>{native ? 'Saved locally on this Mac. No account, cloud, or tracking.' : 'This is a browser preview. Its local data is separate from the desktop app.'}</p></div></div>
      <div className="preferences-footer">Rested <span className="tiny-diamond"/> 0.1.0</div>
    </dialog>
  );
}
