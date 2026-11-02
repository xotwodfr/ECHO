import { beforeEach, describe, expect, it } from 'vitest';
import type { Library } from './library.ts';
import { ensureSourceFor, type Libraries, setSource, sourceStore, startSource } from './source.ts';
import type { Route } from './view.ts';

// One library at a time (docs/superpowers/specs/2026-11-02-source-switch-design.md): which source
// is active, what a link to the other source does, and what happens with only one connected.

const lib = {} as Library;
let route: Route = { view: 'home' };
const views = {
  getState: () => ({
    route,
    back: false,
    navigate: (r: Route) => {
      route = r;
    },
  }),
  subscribe: () => () => undefined,
} as never;
let saved = 'navidrome';
const start = (libs: Libraries, remembered: 'navidrome' | 'spotify') => {
  saved = remembered;
  startSource(libs, views, {
    remembered: () => remembered,
    remember: (s) => {
      saved = s;
    },
  });
};

describe('source', () => {
  beforeEach(() => {
    route = { view: 'home' };
  });

  it('one source: no switch, that source', () => {
    start({ navidrome: null, spotify: lib }, 'navidrome');
    expect(sourceStore.getState()).toEqual({ source: 'spotify', available: ['spotify'] });
  });

  it('both: the remembered one', () => {
    start({ navidrome: lib, spotify: lib }, 'spotify');
    expect(sourceStore.getState()).toEqual({
      source: 'spotify',
      available: ['navidrome', 'spotify'],
    });
  });

  it('remembered spotify, now navidrome only → navidrome', () => {
    start({ navidrome: lib, spotify: null }, 'spotify');
    expect(sourceStore.getState().source).toBe('navidrome');
  });

  it('a spotify album route switches to spotify, and is remembered', () => {
    start({ navidrome: lib, spotify: lib }, 'navidrome');
    ensureSourceFor({ view: 'album', id: 'spotify:abc' });
    expect(sourceStore.getState().source).toBe('spotify');
    expect(saved).toBe('spotify');
  });

  it('a genre route switches to navidrome', () => {
    start({ navidrome: lib, spotify: lib }, 'spotify');
    ensureSourceFor({ view: 'genre', name: 'Jazz' });
    expect(sourceStore.getState().source).toBe('navidrome');
  });

  it('a route to an unavailable source changes nothing', () => {
    start({ navidrome: lib, spotify: null }, 'navidrome');
    ensureSourceFor({ view: 'playlist', id: 'spotify:pl' });
    expect(sourceStore.getState().source).toBe('navidrome');
  });

  it('setSource on a page of the other source goes Home; on Home it stays', () => {
    start({ navidrome: lib, spotify: lib }, 'navidrome');
    route = { view: 'album', id: 'al-1' };
    setSource('spotify');
    expect(route).toEqual({ view: 'home' });
    expect(saved).toBe('spotify');
    route = { view: 'library', tab: 'albums' };
    setSource('navidrome');
    expect(route).toEqual({ view: 'library', tab: 'albums' });
  });
});
