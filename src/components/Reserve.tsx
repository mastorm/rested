import { clock, duration, reserveScale } from '../lib/format';
import type { Snapshot } from '../lib/types';
import { Landscape } from './Artwork';

export function Reserve({ state }: { state: Snapshot | null }) {
  const balance = state?.balanceMs ?? 0;
  const scale = reserveScale(balance);
  const status = state?.mode === 'study' ? 'Earning at 2×' : state?.mode === 'play' ? 'Adventure in progress' : balance > 0 ? 'Ready for adventure' : 'Your journey starts with studying';

  return (
    <section className={`reserve metal-frame ${state?.mode ?? 'idle'}`} aria-labelledby="reserve-title">
      <Landscape/>
      <div className="reserve-heading">
        <div><span className="eyebrow" id="reserve-title">Your playtime reserve</span><p><span className={`status-dot ${state?.mode ? 'live' : ''}`}/>{status}</p></div>
        <div className="reserve-amount"><span className="reserve-clock" data-testid="reserve-clock">{clock(balance)}</span><span>available in Azeroth</span></div>
      </div>
      <div className="xp-frame">
        <span className="xp-endcap left"/>
        <div className="xp-bar" role="meter" aria-label="Available playtime" aria-valuemin={0} aria-valuemax={scale / 1000} aria-valuenow={balance / 1000} aria-valuetext={`${duration(balance)} available`}>
          <div className="xp-fill" style={{ width: `${balance / scale * 100}%` }}><span/></div>
          <div className="xp-segments"/>
        </div>
        <span className="xp-endcap right"/>
      </div>
      <div className="reserve-scale"><span>Empty</span><span>Your reserve carries over between days</span><span>{duration(scale)}</span></div>
    </section>
  );
}
