// Transport and Stage view shortcuts from the keyboard map (PRODUCT_SPEC.md §7). Pure, so the
// rules are tested as a table. F, G-sequences and the ? sheet arrive with the features they control.

export type Shortcut =
  | 'toggle'
  | 'seekBack'
  | 'seekForward'
  | 'seekBackFar'
  | 'seekForwardFar'
  | 'previous'
  | 'next'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'shuffle'
  | 'repeat'
  | 'queue'
  | 'viewCycle'
  | 'viewCover'
  | 'viewLyrics'
  | 'lyricsEarlier'
  | 'lyricsLater'
  | 'goPrefix'
  | 'goLibrary'
  | 'goSettings'
  | 'goListen'
  | 'fullscreen'
  | 'like'
  | 'help';

/**
 * Where the key was pressed. `text`: shortcuts never fire (§7). `control`: a focused button,
 * link, slider or menu item owns Space and the arrows, so only letter shortcuts apply.
 */
export type KeyTarget = 'text' | 'control' | 'other';

type Key = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean };

/** `afterG`: G was pressed just before, so this key completes a G-sequence (§7: G then L/S/P). */
export function shortcutFor(
  e: Key,
  target: KeyTarget,
  stage: boolean,
  afterG = false,
): Shortcut | null {
  if (target === 'text') return null;
  // Spotify's Like: Alt+Shift+B (its only Alt shortcut here; Alt is the browser's otherwise).
  if (e.altKey)
    return e.shiftKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'b' ? 'like' : null;
  const mod = e.ctrlKey || e.metaKey;
  const owned = target === 'control';
  if (afterG && !mod) {
    const go: Record<string, Shortcut> = { l: 'goLibrary', s: 'goSettings', p: 'goListen' };
    return go[e.key.toLowerCase()] ?? null;
  }
  switch (e.key) {
    case ' ':
      return owned || mod ? null : 'toggle';
    case 'ArrowLeft':
      if (owned) return null;
      return mod ? 'previous' : e.shiftKey ? 'seekBackFar' : 'seekBack';
    case 'ArrowRight':
      if (owned) return null;
      return mod ? 'next' : e.shiftKey ? 'seekForwardFar' : 'seekForward';
    // Volume on ↑/↓ only on the Stage: in the shell views the arrows keep scrolling the page.
    case 'ArrowUp':
      return owned || mod || !stage ? null : 'volumeUp';
    case 'ArrowDown':
      return owned || mod || !stage ? null : 'volumeDown';
  }
  if (mod) return null;
  if (e.key === '?') return 'help';
  const letters: Record<string, Shortcut> = {
    m: 'mute',
    s: 'shuffle',
    r: 'repeat',
    q: 'queue',
    g: 'goPrefix',
    f: 'fullscreen',
  };
  // The view keys act on the Stage only, so they never change an invisible setting elsewhere.
  const stageLetters: Record<string, Shortcut> = {
    v: 'viewCycle',
    c: 'viewCover',
    l: 'viewLyrics',
    // The lyric timing offset, ±50 ms (LYRICS_EXPERIENCE.md §9.13).
    '[': 'lyricsEarlier',
    ']': 'lyricsLater',
  };
  const k = e.key.toLowerCase();
  return letters[k] ?? (stage ? (stageLetters[k] ?? null) : null);
}

// A focused static lyric sheet (role="document", LYRICS_EXPERIENCE.md §9.3) scrolls with the arrows.
const CONTROLS =
  'button, a[href], select, summary, [role="slider"], [role="menuitem"], [role="switch"], [role="document"]';

export function keyTarget(el: EventTarget | null): KeyTarget {
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
    return 'text';
  return el instanceof Element && el.closest(CONTROLS) ? 'control' : 'other';
}
