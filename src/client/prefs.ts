import { createStore } from 'zustand/vanilla';
import { api } from './api.ts';

// The user's preferences (SETTINGS_AND_SECURITY.md §7.1). Most follow the user across devices and
// live on the server (`/me/settings`); `visuals.quality` and `playback.quality` differ per device
// (a gaming PC and a laptop) and live in this browser's localStorage. Defaults apply until the
// server answers, and without a server at all (the fixture shell).

export interface Prefs {
  playback: {
    defaultProvider: 'navidrome' | 'spotify';
    crossfadeSec: number;
    replayGain: 'off' | 'track' | 'album' | 'auto';
    scrobble: boolean;
    quality: 'auto' | 'raw' | '320' | '192' | '128'; // per device
  };
  lyrics: {
    sizeScale: 0.85 | 1 | 1.15 | 1.3;
    globalOffsetMs: number;
    showUnsynced: boolean;
    announceLines: boolean;
    useSpotifyForLookup: boolean;
  };
  visuals: {
    mode: 'auto' | 'reverb' | 'ambient' | 'still';
    intensity: 'subtle' | 'balanced' | 'expressive';
    quality: 'auto' | 'high' | 'balanced' | 'low' | 'minimal'; // per device
    motion: 'system' | 'full' | 'reduced' | 'off';
    grain: boolean;
    pointerParallax: boolean;
  };
}

export const DEFAULT_PREFS: Prefs = {
  playback: {
    defaultProvider: 'navidrome',
    crossfadeSec: 0,
    replayGain: 'auto',
    scrobble: true,
    quality: 'auto',
  },
  lyrics: {
    sizeScale: 1,
    globalOffsetMs: 0,
    showUnsynced: true,
    announceLines: false,
    useSpotifyForLookup: false,
  },
  visuals: {
    mode: 'auto',
    intensity: 'expressive',
    quality: 'auto',
    motion: 'system',
    grain: false,
    pointerParallax: true,
  },
};

type Section = keyof Prefs;
/** Keys kept per device, in localStorage, never sent to the server. */
const DEVICE: { [S in Section]?: (keyof Prefs[S])[] } = {
  playback: ['quality'],
  visuals: ['quality'],
};
const isDevice = (s: Section, k: string) => (DEVICE[s] as string[] | undefined)?.includes(k);
const storageKey = (s: Section, k: string) => `echo.${s}.${k}`;

function readDevice(): Partial<Prefs> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [s, keys] of Object.entries(DEVICE))
    for (const k of keys as string[])
      try {
        const v = localStorage.getItem(storageKey(s as Section, k));
        if (v !== null) out[s] = { ...out[s], [k]: JSON.parse(v) };
      } catch {} // private windows and blocked storage: the default stands
  return out as Partial<Prefs>;
}

const merge = (base: Prefs, patch: Partial<Record<Section, object>>): Prefs => ({
  playback: { ...base.playback, ...patch.playback },
  lyrics: { ...base.lyrics, ...patch.lyrics },
  visuals: { ...base.visuals, ...patch.visuals },
});

export const prefsStore = createStore<Prefs & { loaded: boolean }>()(() => ({
  ...merge(DEFAULT_PREFS, readDevice()),
  loaded: false,
}));

/** The server's preferences for the signed-in user, over this device's own. */
export async function loadPrefs() {
  const server = await api<Partial<Prefs>>('/me/settings').catch(() => null);
  if (server) {
    const { version: _v, ...sections } = server as Partial<Prefs> & { version?: number };
    // Device keys win: the server never has them.
    prefsStore.setState({
      ...merge(merge(prefsStore.getState(), sections), readDevice()),
      loaded: true,
    });
  } else prefsStore.setState({ loaded: true });
}

/** Sets one preference: here at once, then on the server (or in localStorage for device keys). */
export async function setPref<S extends Section, K extends keyof Prefs[S]>(
  section: S,
  key: K,
  value: Prefs[S][K],
) {
  const before = prefsStore.getState()[section];
  prefsStore.setState({ [section]: { ...before, [key]: value } } as Partial<Prefs>);
  if (isDevice(section, key as string)) {
    try {
      localStorage.setItem(storageKey(section, key as string), JSON.stringify(value));
    } catch {}
    return;
  }
  try {
    await api('/me/settings', { method: 'PUT', body: { [section]: { [key]: value } } });
  } catch (err) {
    prefsStore.setState({ [section]: before } as Partial<Prefs>); // the server refused: undo
    throw err;
  }
}
