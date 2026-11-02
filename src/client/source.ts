import { createStore } from 'zustand/vanilla';
import type { Library } from './library.ts';
import type { Route, ViewStore } from './view.ts';

// One library at a time (docs/superpowers/specs/2026-11-02-source-switch-design.md): the user's
// Navidrome or their Spotify, chosen by the switch (Settings → Default service is the same
// setting). Pages read the active one; a link to the other source's item flips to it. Playback is
// not involved: the queue carries on whichever source it came from.

export type Source = 'navidrome' | 'spotify';
export type Libraries = { navidrome: Library | null; spotify: Library | null };

export const sourceStore = createStore<{ source: Source; available: Source[] }>()(() => ({
  source: 'navidrome',
  available: [],
}));

/** Which source an id belongs to: Spotify's carry the `spotify:` prefix (library-spotify.ts). */
export const sourceOf = (id: string): Source =>
  id.startsWith('spotify:') ? 'spotify' : 'navidrome';

/** The source a route's page belongs to; null for pages both sources have (Home, Library, …). */
function routeSource(route: Route): Source | null {
  if (route.view === 'album' || route.view === 'artist' || route.view === 'playlist')
    return sourceOf(route.id);
  if (route.view === 'genre' || route.view === 'mix' || route.view === 'wrapped')
    return 'navidrome';
  return null;
}

let views: ViewStore | null = null;
let memory: { remembered(): Source; remember(s: Source): void } | null = null;

function pick(s: Source) {
  const { source, available } = sourceStore.getState();
  if (s === source || !available.includes(s)) return false;
  sourceStore.setState({ source: s });
  memory?.remember(s);
  return true;
}

export function startSource(
  libs: Libraries,
  viewStore: ViewStore,
  mem: { remembered(): Source; remember(s: Source): void },
) {
  views = viewStore;
  memory = mem;
  const available = (['navidrome', 'spotify'] as const).filter((s) => libs[s]);
  const wanted = mem.remembered();
  const source = available.includes(wanted) ? wanted : (available[0] ?? 'navidrome');
  sourceStore.setState({ source, available });
  ensureSourceFor(viewStore.getState().route);
  return viewStore.subscribe((s, prev) => s.route !== prev.route && ensureSourceFor(s.route));
}

/** A page of the other source (a shared link, "Go to album" from the player) switches to it. */
export function ensureSourceFor(route: Route) {
  const s = routeSource(route);
  if (s) pick(s);
}

/** The switch: another source, and Home if the page on screen belongs to the one left behind. */
export function setSource(s: Source) {
  if (!pick(s)) return;
  const route = views?.getState().route;
  const owner = route && routeSource(route);
  if (owner && owner !== s) views?.getState().navigate({ view: 'home' });
}
