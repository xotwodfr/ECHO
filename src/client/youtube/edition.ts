import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { timing } from '../ui/motion.ts';

// YouTube Music mode's two editions (the owner's ask, 2026-11-03): day, on paper, and night. The
// device's dark setting picks one until the masthead's switch is used; then this device keeps the
// choice (per device, like the mode itself).

export type Edition = 'day' | 'night';
const KEY = 'echo.ytEdition';
const DARK = '(prefers-color-scheme: dark)';

/** The stored choice when there is one, else the device's setting. */
export const editionOf = (stored: string | null, systemDark: boolean): Edition =>
  stored === 'day' || stored === 'night' ? stored : systemDark ? 'night' : 'day';

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // storage blocked (a private window): the device decides
  }
}

const listeners = new Set<() => void>();
const current = () => editionOf(stored(), matchMedia(DARK).matches);
function subscribe(changed: () => void) {
  const device = matchMedia(DARK);
  listeners.add(changed);
  device.addEventListener('change', changed);
  return () => {
    listeners.delete(changed);
    device.removeEventListener('change', changed);
  };
}

export const useEdition = () => useSyncExternalStore(subscribe, current, (): Edition => 'day');

/** Switches the edition; with full motion the new one spreads from `from` (the switch). */
export function setEdition(next: Edition, from: HTMLElement) {
  const apply = () => {
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    for (const changed of listeners) changed();
  };
  if (document.documentElement.dataset.motion !== 'full' || !document.startViewTransition)
    return apply();
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const t = document.startViewTransition(() => flushSync(apply));
  void t.ready.then(() =>
    document.documentElement.animate(
      { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${far}px at ${x}px ${y}px)`] },
      { ...timing('spring'), pseudoElement: '::view-transition-new(root)' },
    ),
  );
}
