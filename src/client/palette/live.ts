import { createStore } from 'zustand/vanilla';
import type { Track } from '../../shared/types.ts';
import type { PlaybackController } from '../playback/controller.ts';
import { upcoming } from '../playback/queue.ts';
import { createPaletteAnimator, ROLES, type Roles, VARS } from './animator.ts';
import { M3_ROLES, type M3Role, m3Scheme, m3Var } from './m3.ts';

// The live palette (VISUALIZER_SPEC.md §6.3–§6.4; TECHNICAL_ARCHITECTURE.md §5.4 `paletteStore`):
// follows the current track's album, fetches its palette from the server (and the next track's in
// the background), and animates the `--art-*` properties on :root. It runs at shell level, because
// the dock and the shell use the accent too; the Stage reads the same properties. The shell's M3
// scheme (--md-sys-color-*, DESIGN_SYSTEM.md §3.1) is derived from the accent and animates with
// them. Frames are requested only while a transition runs.

/** Bumped whenever the properties change, so the Stage can re-upload its uniforms. */
export const paletteStore = createStore<{ version: number; albumKey: string | null }>()(() => ({
  version: 0,
  albumKey: null,
}));

type Fetch = (albumKey: string, art?: string) => Promise<Roles | null>;

const fetchPalette: Fetch = async (albumKey, art) => {
  try {
    // Spotify albums name their cover: the server reads it into memory (gate G1, SP-03).
    const q = art ? `?art=${encodeURIComponent(art)}` : '';
    const res = await fetch(`/api/v1/palette/${encodeURIComponent(albumKey)}${q}`);
    return res.ok ? ((await res.json()) as Roles) : null;
  } catch {
    return null; // offline or no server (the fixture-only dev shell): keep what is on screen
  }
};

/** A Spotify track's cover for the server to read: the smallest of at least 128 px (it decodes at 128). */
function artOf(t: Track): string | undefined {
  if (t.provider !== 'spotify') return undefined;
  const fit = [...t.artwork]
    .filter((a) => (a.width ?? 0) >= 128)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (fit[0] ?? t.artwork[0])?.url;
}

export function startPalette(
  c: PlaybackController,
  opts: { root?: HTMLElement; load?: Fetch; instant?: boolean; albumKey?: string } = {},
) {
  const root = opts.root ?? document.documentElement;
  const load = opts.load ?? fetchPalette;
  const cs = getComputedStyle(root);
  type All = Roles & Record<M3Role, string>;
  const KEYS = [...ROLES, ...M3_ROLES] as (keyof All)[];
  const varOf = (k: keyof All) => (k in VARS ? VARS[k as keyof Roles] : m3Var(k as M3Role));
  const withScheme = (art: Roles): All => ({ ...art, ...m3Scheme(art.accent) });
  const initial = Object.fromEntries(
    KEYS.map((r) => [r, cs.getPropertyValue(varOf(r)).trim()]),
  ) as All;
  const fallback = withScheme(initial); // tokens.css: the achromatic fallback, seeded by Sodium
  const anim = createPaletteAnimator<keyof All>(initial);
  const cache = new Map<string, Promise<Roles | null>>();
  const get = (key: string, art?: string) => {
    let p = cache.get(key);
    if (!p) {
      p = load(key, art);
      // Spotify palettes are asked again on every track: gate G1 can change (SP-04).
      if (key.startsWith('spotify:')) void p.finally(() => cache.delete(key));
      cache.set(key, p);
    }
    return p;
  };

  let target = JSON.stringify(KEYS.map((r) => initial[r]));
  let frame = 0;
  let last = 0;
  const write = () => {
    const css = anim.css();
    for (const r of KEYS) root.style.setProperty(varOf(r), css[r]);
    paletteStore.setState((s) => ({ version: s.version + 1 }));
  };
  const tick = (now: number) => {
    // A hidden tab lands on the target at once: no frames for colour nobody sees.
    const dt =
      document.visibilityState === 'hidden' ? Number.POSITIVE_INFINITY : last ? now - last : 0;
    last = now;
    if (anim.step(dt)) write();
    frame = anim.animating ? requestAnimationFrame(tick) : 0;
    if (!frame) last = 0;
  };

  async function show(albumKey: string | null, art?: string) {
    paletteStore.setState({ albumKey });
    const fetched = albumKey ? await get(albumKey, art) : null;
    const roles = fetched ? withScheme(fetched) : fallback;
    if (paletteStore.getState().albumKey !== albumKey) return; // a newer track won
    // The same colours again (another track of the album, or fallback after fallback): nothing
    // to animate, nothing to write.
    const key = JSON.stringify(KEYS.map((r) => roles[r]));
    if (key === target) return;
    target = key;
    if (opts.instant) {
      anim.set(roles);
      write();
      return;
    }
    anim.retarget(roles);
    if (document.visibilityState === 'hidden') tick(0);
    else if (!frame) frame = requestAnimationFrame(tick);
  }

  const onTrack = () => {
    const track = c.player.getState().track;
    void show(opts.albumKey ?? track?.album.key ?? null, track ? artOf(track) : undefined);
    // Prefetch the next track's palette, so it is ready when the track changes.
    const next = upcoming(c.queue.getState())[0];
    if (next && next.album.key !== track?.album.key) void get(next.album.key, artOf(next));
  };
  // Another album, or for Spotify any other track (gate G1 may have changed, SP-04).
  const off = c.player.subscribe(
    (s, prev) =>
      (s.track?.album.key !== prev.track?.album.key ||
        (s.track?.provider === 'spotify' && s.track.key !== prev.track?.key)) &&
      onTrack(),
  );
  onTrack();

  return () => {
    off();
    if (frame) cancelAnimationFrame(frame);
  };
}
