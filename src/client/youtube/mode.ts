import type { ViewState } from '../view.ts';

// Which world this device is in, Navidrome or YouTube Music (spec call 8): per device, so a phone
// can stay in YouTube Music while the desktop stays in Navidrome. The switch only changes what you
// browse; the player and the queue carry on (spec call 9).

export type Mode = 'navidrome' | 'youtube';
const KEY = 'echo.mode';

export function savedMode(): Mode {
  try {
    return localStorage.getItem(KEY) === 'youtube' ? 'youtube' : 'navidrome';
  } catch {
    return 'navidrome'; // storage blocked (a private window): Navidrome
  }
}

export function switchMode(to: Mode, navigate: ViewState['navigate']) {
  try {
    localStorage.setItem(KEY, to);
  } catch {}
  navigate(to === 'youtube' ? { view: 'yt', page: { kind: 'home' } } : { view: 'home' });
}
