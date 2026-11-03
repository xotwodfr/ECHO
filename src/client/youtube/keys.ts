import { useEffect } from 'react';
import { usePlayback } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { keyTarget, type Shortcut, shortcutFor } from '../shell/shortcuts.ts';

// ECHO's playback keys in YouTube Music mode (the Liner notes spec): space, ←/→ (Shift: far), M, S,
// R, and the previous/next keys; Q opens Up next. ↑/↓ scroll the page, as on ECHO's own pages (they
// set the volume only on its Stage). Never while typing (shortcutFor).

const SEEK_MS = 5000;
const SEEK_FAR_MS = 15_000;

export function useYtShortcuts(open: (tab: 'next' | 'lyrics') => void) {
  const c = usePlayback();
  useEffect(() => {
    const at = () => positionNow(c.player.getState(), performance.now());
    const run: Partial<Record<Shortcut, () => void>> = {
      toggle: c.toggle,
      seekBack: () => c.seek(at() - SEEK_MS),
      seekForward: () => c.seek(at() + SEEK_MS),
      seekBackFar: () => c.seek(at() - SEEK_FAR_MS),
      seekForwardFar: () => c.seek(at() + SEEK_FAR_MS),
      previous: c.previous,
      next: () => c.hasNext() && c.next(),
      mute: c.toggleMute,
      shuffle: c.toggleShuffle,
      repeat: c.cycleRepeat,
      queue: () => open('next'),
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = shortcutFor(e, keyTarget(e.target), false);
      const fn = action && run[action];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c, open]);
}
