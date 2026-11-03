import { useStore } from 'zustand';
import { sessionStore } from '../session.ts';
import { useView } from '../shell/link.tsx';
import { strings } from '../strings.ts';
import { switchMode } from './mode.ts';

/**
 * Navidrome | YouTube Music, in the top bar of both worlds (spec call 7: shown whenever the admin
 * switch is on, signed in to YouTube or not). Each world styles it in its own look (`.mode-switch`).
 */
export function ModeSwitch() {
  const session = useStore(sessionStore);
  const navigate = useView((s) => s.navigate);
  const youtube = useView((s) => s.route.view === 'yt');
  if (session.status !== 'signedIn' || !session.youtube?.enabled) return null;
  const y = strings.youtube;
  return (
    <fieldset className="mode-switch">
      <legend className="visually-hidden">{y.switchLabel}</legend>
      <button
        className="mode-btn"
        type="button"
        aria-pressed={!youtube}
        onClick={() => youtube && switchMode('navidrome', navigate)}
      >
        {y.navidrome}
      </button>
      <button
        className="mode-btn"
        type="button"
        aria-pressed={youtube}
        onClick={() => !youtube && switchMode('youtube', navigate)}
      >
        <span className="mode-dot" aria-hidden="true" />
        {y.name}
      </button>
    </fieldset>
  );
}
