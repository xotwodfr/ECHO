import { createStore } from 'zustand/vanilla';
import type { DarkMode, ThemeId } from '../shared/themes.ts';
import { api } from './api.ts';
import type { EqPreset } from './playback/eq.ts';

// The user's preferences (SETTINGS_AND_SECURITY.md §7.1). Most follow the user across devices and
// live on the server (`/me/settings`); `visuals.quality`, `backdrop` and `performance`, `playback.quality`, the volume, crossfade, equalizer and karaoke differ per device
// (a gaming PC and a laptop) and live in this browser's localStorage. Defaults apply until the
// server answers, and without a server at all (the fixture shell). The appearance follows the user
// too, and this browser keeps a copy, so the page opens in its theme before the server answers
// (and keeps it without a server).

export interface Prefs {
  playback: {
    /** Settings → Playback → Crossfade, 0 (off) to 12 s; per device (its own speakers). */
    crossfadeSec: number;
    replayGain: 'off' | 'track' | 'album' | 'auto';
    scrobble: boolean;
    /** When the music runs out, similar songs follow (Spotify's Autoplay); per device, as Spotify's. */
    autoplay: boolean;
    quality: 'auto' | 'raw' | '320' | '192' | '128'; // per device
    volume: number; // 0..1, per device (its own speakers)
    /** Karaoke mode (docs/KARAOKE.md), per device; and how much of the voice it leaves, 0..1. */
    karaoke: boolean;
    vocalLevel: number;
    /** Karaoke's key change in semitones, −6..6; kept while Karaoke is off, applied only while it's on. */
    karaokeKey: number;
    /** The equalizer (per device): on or off, the preset, and the custom curve's ten bands in dB. */
    eq: boolean;
    eqPreset: EqPreset;
    eqGains: number[];
  };
  lyrics: {
    sizeScale: 0.85 | 1 | 1.15 | 1.3;
    globalOffsetMs: number;
    showUnsynced: boolean;
    announceLines: boolean;
    disabledSources: string[];
  };
  visuals: {
    mode: 'auto' | 'reverb' | 'ambient' | 'still';
    intensity: 'subtle' | 'balanced' | 'expressive';
    quality: 'auto' | 'high' | 'balanced' | 'low' | 'minimal'; // per device
    motion: 'system' | 'full' | 'reduced' | 'off';
    grain: boolean;
    pointerParallax: boolean;
    backdrop: number; // 0..1, per device: the Stage's blurred-cover brightness (its own screen)
    /** Performance mode, per device (a slow laptop): see effectiveVisuals. */
    performance: boolean;
  };
  /** The theme (appearance.ts) and light or dark. */
  appearance: {
    theme: ThemeId;
    dark: DarkMode;
  };
}

export const DEFAULT_PREFS: Prefs = {
  playback: {
    crossfadeSec: 0,
    replayGain: 'auto',
    scrobble: true,
    autoplay: true,
    quality: 'auto',
    volume: 1,
    karaoke: false,
    vocalLevel: 0,
    karaokeKey: 0,
    eq: false,
    eqPreset: 'flat',
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  lyrics: {
    sizeScale: 1,
    globalOffsetMs: 0,
    showUnsynced: true,
    announceLines: false,
    disabledSources: [],
  },
  visuals: {
    mode: 'auto',
    intensity: 'expressive',
    quality: 'auto',
    motion: 'system',
    grain: false,
    pointerParallax: true,
    backdrop: 0.5,
    performance: false,
  },
  appearance: { theme: 'echo', dark: 'theme' },
};

/**
 * The visuals as they apply, Settings → Visuals → Performance mode over what was saved (owner,
 * 2026-11-04): the smaller animations everywhere, which also hold the Listen room still, at the
 * lightest quality. Measured on a 4×-throttled Chromium, the live room took Listen to 6 fps and the
 * page animations to 41; with these both stayed at 57–60 fps. The lyrics keep moving word by word
 * (owner): only motion "off", chosen as such, gives the still sheet. The saved choices stay
 * underneath, for when it is switched off.
 */
export function effectiveVisuals(v: Prefs['visuals']): Prefs['visuals'] {
  if (!v.performance) return v;
  return { ...v, motion: v.motion === 'off' ? 'off' : 'reduced', quality: 'minimal' };
}

type Section = keyof Prefs;
/** Keys kept per device, in localStorage, never sent to the server. */
const DEVICE: { [S in Section]?: (keyof Prefs[S])[] } = {
  playback: [
    'quality',
    'volume',
    'autoplay',
    'karaoke',
    'vocalLevel',
    'karaokeKey',
    'crossfadeSec',
    'eq',
    'eqPreset',
    'eqGains',
  ],
  visuals: ['quality', 'backdrop', 'performance'],
};
const isDevice = (s: Section, k: string) => (DEVICE[s] as string[] | undefined)?.includes(k);
/** Keys that follow the user and are also copied here, for the first paint. */
const COPIED: { [S in Section]?: (keyof Prefs[S])[] } = { appearance: ['theme', 'dark'] };
const storageKey = (s: Section, k: string) => `echo.${s}.${k}`;

function readDevice(from = DEVICE): Partial<Prefs> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [s, keys] of Object.entries(from))
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
  appearance: { ...base.appearance, ...patch.appearance },
});

/** `synced`: the server answered, and keeps what changes from now on. */
export const prefsStore = createStore<Prefs & { loaded: boolean; synced: boolean }>()(() => ({
  ...merge(merge(DEFAULT_PREFS, readDevice(COPIED)), readDevice()),
  loaded: false,
  synced: false,
}));

const keepCopy = (section: Section, key: string, value: unknown) => {
  try {
    localStorage.setItem(storageKey(section, key), JSON.stringify(value));
  } catch {} // private windows and blocked storage: the server's copy stands
};

/** The server's preferences for the signed-in user, over this device's own. */
export async function loadPrefs() {
  const server = await api<Partial<Prefs>>('/me/settings').catch(() => null);
  if (server) {
    const { version: _v, ...sections } = server as Partial<Prefs> & { version?: number };
    // Device keys win: the server never has them.
    prefsStore.setState({
      ...merge(merge(prefsStore.getState(), sections), readDevice()),
      loaded: true,
      synced: true,
    });
    const a = prefsStore.getState().appearance;
    for (const k of COPIED.appearance ?? []) keepCopy('appearance', k, a[k]);
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
    keepCopy(section, key as string, value);
    return;
  }
  const copied = (COPIED[section] as string[] | undefined)?.includes(key as string);
  if (copied) {
    keepCopy(section, key as string, value);
    // No server to keep it (the fixture shell, or signed out): this browser's copy is all there is.
    if (!prefsStore.getState().synced) return;
  }
  try {
    await api('/me/settings', { method: 'PUT', body: { [section]: { [key]: value } } });
  } catch (err) {
    prefsStore.setState({ [section]: before } as Partial<Prefs>); // the server refused: undo
    if (copied) keepCopy(section, key as string, before[key]);
    throw err;
  }
}
