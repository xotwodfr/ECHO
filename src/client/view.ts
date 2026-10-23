import { createStore } from 'zustand/vanilla';

// viewStore (TECHNICAL_ARCHITECTURE.md §5.4): the current view and its params, kept in sync with
// browser history so every view is a deep link. No router library (§3, "Not used").

export const LIBRARY_TABS = ['albums', 'artists', 'playlists', 'starred'] as const;
export const SETTINGS_SECTIONS = ['preferences', 'account'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Route =
  | { view: 'listen' }
  | { view: 'library'; tab: LibraryTab }
  | { view: 'album'; id: string }
  | { view: 'search'; q: string }
  | { view: 'settings'; section: SettingsSection }
  | { view: 'notFound'; path: string };

const isOneOf = <T extends string>(list: readonly T[], v: string | undefined): v is T =>
  list.includes(v as T);

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
  if (!head) return { view: 'listen' };
  if (head === 'library') {
    if (a === undefined) return { view: 'library', tab: 'albums' };
    if (isOneOf(LIBRARY_TABS, a) && b === undefined) return { view: 'library', tab: a };
    if (a === 'album' && b && rest.length === 0) return { view: 'album', id: b };
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
    case 'listen':
      return '/';
    case 'library':
      return route.tab === 'albums' ? '/library' : `/library/${route.tab}`;
    case 'album':
      return `/library/album/${encodeURIComponent(route.id)}`;
    case 'search':
      return route.q ? `/search?${new URLSearchParams({ q: route.q })}` : '/search';
    case 'settings':
      return route.section === 'preferences' ? '/settings' : `/settings/${route.section}`;
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
