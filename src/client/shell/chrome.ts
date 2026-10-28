import { useEffect } from 'react';
import { stageChrome } from '../stage/status.ts';

// Stage chrome auto-hide (PRODUCT_SPEC.md §6.1): the top bar and dock controls fade after 3 s
// without pointer or keyboard input while playing; any input restores them.

export const CHROME_IDLE_MS = 3000;

const INPUTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Hides only when nothing needs the chrome: playback is running, no dialog (queue sheet) or menu
 * is open, and keyboard focus is not on a control in it, the attribution line's ⓘ included (focus
 * is never hidden, WCAG 2.4.11).
 */
function mayHide() {
  if (document.querySelector('dialog[open], .menu')) return false;
  const el = document.activeElement;
  return !(el?.closest('.dock, .stage-chrome, .stage-attribution') && el.matches(':focus-visible'));
}

export function useChromeIdle(enabled: boolean) {
  useEffect(() => {
    const show = () => stageChrome.setState({ hidden: false });
    if (!enabled) return show();
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (mayHide()) stageChrome.setState({ hidden: true });
        else arm();
      }, CHROME_IDLE_MS);
    };
    const onInput = () => {
      show();
      arm();
    };
    for (const type of INPUTS) window.addEventListener(type, onInput, { passive: true });
    arm();
    return () => {
      clearTimeout(timer);
      for (const type of INPUTS) window.removeEventListener(type, onInput);
      show();
    };
  }, [enabled]);
}
