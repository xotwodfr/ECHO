import { useEffect } from 'react';
import { usePlayback } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { keyTarget, type Shortcut, shortcutFor } from '../shell/shortcuts.ts';

// ECHO's playback keys in YouTube Music mode (the Liner notes spec): space, ←/→ (Shift: far), ↑/↓,
// M, S, R, and the previous/next keys; Q opens Up next. Never while typing (shortcutFor). The rest
// of ECHO's keys belong to Navidrome mode's dock.

const SEEK_MS = 5000;
const SEEK_FAR_MS = 15_000;
const VOLUME_STEP = 0.05;

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
      volumeUp: () => c.setVolume(c.player.getState().volume + VOLUME_STEP),
      volumeDown: () => c.setVolume(c.player.getState().volume - VOLUME_STEP),
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
