import { createStore } from 'zustand/vanilla';
import type { Tier } from './stage/renderer.ts';

// viewStore (TECHNICAL_ARCHITECTURE.md §5.4): the current view and its params, kept in sync with
// browser history so every view is a deep link. No router library (§3, "Not used").

export const LIBRARY_TABS = ['albums', 'artists', 'playlists', 'starred'] as const;
export const SETTINGS_SECTIONS = ['preferences', 'account', 'admin'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Deterministic mode (VISUALIZER_SPEC.md §10), `/?frame=<ms>&seed=<n>&fixture=<name>&tier=<T0..T3>`
 * plus ECHO's `track=<id>`: one Stage frame at song time `ms`, for visual snapshots and
 * design-review screenshots.
 */
export interface FrameParams {
  ms: number;
  seed: number;
  /** A library track id, cued paused at `ms` so the dock shows it (development builds). */
  track?: string;
  /**
   * A Features fixture (§10), or a lyric fixture (LYRICS_EXPERIENCE.md §16), which also cues its
   * guide track when `track` is absent.
   */
  fixture?: string;
  tier?: Tier;
  /** An album key whose palette the frame shows instead of the cued track's (M4: VIS-05). */
  palette?: string;
  /** Query params this mode does not use, kept in the URL as they came (`a=1&b=2`). */
  other?: string;
}

export type Route =
  | { view: 'listen'; frame?: FrameParams }
  | { view: 'library'; tab: LibraryTab }
  | { view: 'album'; id: string }
  | { view: 'artist'; id: string }
  | { view: 'search'; q: string }
  | { view: 'settings'; section: SettingsSection }
  | { view: 'ui' }
  | { view: 'login' }
  | { view: 'setup' } // the one-time admin setup; its token travels in the fragment
  | { view: 'invite' } // redeeming an invite; its token travels in the fragment too
  | { view: 'notFound'; path: string };

const isOneOf = <T extends string>(list: readonly T[], v: string | undefined): v is T =>
  list.includes(v as T);

const TIER_NAMES: readonly Tier[] = ['T0', 'T1', 'T2', 'T3'];
const FRAME_KEYS = ['frame', 'seed', 'track', 'fixture', 'tier', 'palette'];
const isWhole = (v: string | null): v is string => v !== null && /^\d+$/.test(v);

/**
 * The deterministic-mode params, or undefined when `frame` is missing or malformed. A malformed
 * `seed` or `tier`, or an empty `track` or `fixture`, is dropped; other params are kept.
 */
export function parseFrame(search: string): FrameParams | undefined {
  const p = new URLSearchParams(search);
  const frame = p.get('frame');
  const seed = p.get('seed');
  const track = p.get('track');
  const fixture = p.get('fixture');
  const tier = p.get('tier') ?? undefined;
  const palette = p.get('palette');
  if (!isWhole(frame)) return undefined;
  const other = String(new URLSearchParams([...p].filter(([k]) => !FRAME_KEYS.includes(k))));
  return {
    ms: Number(frame),
    seed: isWhole(seed) ? Number(seed) : 0,
    ...(track && { track }),
    ...(fixture && { fixture }),
    ...(isOneOf(TIER_NAMES, tier) && { tier }),
    ...(palette && { palette }),
    ...(other && { other }),
  };
}

export function parseRoute(pathname: string, search = ''): Route {
  const notFound: Route = { view: 'notFound', path: pathname + search };
  const parts = pathname.split('/').filter(Boolean);
  let decoded: string[];
  try {
    decoded = parts.map(decodeURIComponent);
  } catch {
    return notFound;
  }
  const [head, a, b, ...rest] = decoded;
  if (!head) {
    const frame = parseFrame(search);
    return frame ? { view: 'listen', frame } : { view: 'listen' };
  }
  if (head === '__ui' && a === undefined) return { view: 'ui' };
  if (head === 'login' && a === undefined) return { view: 'login' };
  if (head === 'setup' && a === undefined) return { view: 'setup' };
  if (head === 'invite' && a === undefined) return { view: 'invite' };
  if (head === 'library') {
    if (a === undefined) return { view: 'library', tab: 'albums' };
    if (isOneOf(LIBRARY_TABS, a) && b === undefined) return { view: 'library', tab: a };
    if (a === 'album' && b && rest.length === 0) return { view: 'album', id: b };
    if (a === 'artist' && b && rest.length === 0) return { view: 'artist', id: b };
  }
  if (head === 'search' && a === undefined) {
    return { view: 'search', q: new URLSearchParams(search).get('q') ?? '' };
  }
  if (head === 'settings') {
    if (a === undefined) return { view: 'settings', section: 'preferences' };
    if (isOneOf(SETTINGS_SECTIONS, a) && b === undefined) return { view: 'settings', section: a };
  }
  return notFound;
}

/** The canonical URL (path + query) of a route. Defaults are left out: `/library`, `/settings`. */
export function routePath(route: Route): string {
  switch (route.view) {
    case 'listen': {
      const f = route.frame;
      if (!f) return '/';
      const q = new URLSearchParams({ frame: String(f.ms) });
      if (f.seed) q.set('seed', String(f.seed));
      if (f.track) q.set('track', f.track);
      if (f.fixture) q.set('fixture', f.fixture);
      if (f.palette) q.set('palette', f.palette);
      if (f.tier) q.set('tier', f.tier);
      return f.other ? `/?${q}&${f.other}` : `/?${q}`;
    }
    case 'library':
      return route.tab === 'albums' ? '/library' : `/library/${route.tab}`;
    case 'album':
      return `/library/album/${encodeURIComponent(route.id)}`;
    case 'artist':
      return `/library/artist/${encodeURIComponent(route.id)}`;
    case 'search':
      return route.q ? `/search?${new URLSearchParams({ q: route.q })}` : '/search';
    case 'settings':
      return route.section === 'preferences' ? '/settings' : `/settings/${route.section}`;
    case 'ui':
      return '/__ui';
    case 'login':
      return '/login';
    case 'setup':
      return '/setup';
    case 'invite':
      return '/invite';
    case 'notFound':
      return route.path;
  }
}

/** The parts of `window` the store needs, so tests can pass a fake. */
export interface HistoryHost {
  location: { pathname: string; search: string };
  history: Pick<History, 'pushState' | 'replaceState'>;
  addEventListener(type: 'popstate', fn: () => void): void;
}

export interface ViewState {
  route: Route;
  /** Push a history entry (or replace the current one) and show `route`. */
  navigate(route: Route, opts?: { replace?: boolean }): void;
}

export function createViewStore(host: HistoryHost) {
  const here = () => host.location.pathname + host.location.search;
  const initial = parseRoute(host.location.pathname, host.location.search);
  // Deep links arrive in any spelling (`/library/albums`, `/settings/`); keep the canonical one.
  if (routePath(initial) !== here()) host.history.replaceState(null, '', routePath(initial));

  const store = createStore<ViewState>()((set) => ({
    route: initial,
    navigate(route, opts) {
      const path = routePath(route);
      // Re-selecting the current view must not stack duplicate entries for Back.
      if (opts?.replace || path === here()) host.history.replaceState(null, '', path);
      else host.history.pushState(null, '', path);
      set({ route });
    },
  }));

  host.addEventListener('popstate', () =>
    store.setState({ route: parseRoute(host.location.pathname, host.location.search) }),
  );
  return store;
}

export type ViewStore = ReturnType<typeof createViewStore>;
