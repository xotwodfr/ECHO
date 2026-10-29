import { describe, expect, it } from 'vitest';
import { createViewStore, type HistoryHost, parseRoute, type Route, routePath } from './view.ts';

// A minimal browser history: a stack of URLs, a cursor, and popstate on back/forward.
function fakeHost(start: string) {
  const entries = [start];
  let at = 0;
  let onPop = () => {};
  const location = { pathname: '', search: '' };
  const sync = () => {
    const url = new URL(entries[at] as string, 'http://echo.test');
    location.pathname = url.pathname;
    location.search = url.search;
  };
  sync();
  const host: HistoryHost = {
    location,
    history: {
      pushState: (_s, _t, url) => {
        entries.splice(at + 1, Infinity, String(url));
        at++;
        sync();
      },
      replaceState: (_s, _t, url) => {
        entries[at] = String(url);
        sync();
      },
    },
    addEventListener: (_type, fn) => {
      onPop = fn;
    },
  };
  const go = (delta: number) => {
    at += delta;
    sync();
    onPop();
  };
  return { host, entries, back: () => go(-1), forward: () => go(1), url: () => entries[at] };
}

const CANONICAL: [string, Route][] = [
  ['/', { view: 'home' }],
  ['/listen', { view: 'listen' }],
  ['/playlist/pl-3', { view: 'playlist', id: 'pl-3' }],
  ['/collection/tracks', { view: 'liked' }],
  ['/genre/Dream%20Pop', { view: 'genre', name: 'Dream Pop' }],
  ['/library', { view: 'library', tab: 'albums' }],
  ['/library/artists', { view: 'library', tab: 'artists' }],
  ['/library/playlists', { view: 'library', tab: 'playlists' }],
  ['/library/starred', { view: 'library', tab: 'starred' }],
  ['/library/album/al-42', { view: 'album', id: 'al-42' }],
  ['/library/album/a%2Fb%20c', { view: 'album', id: 'a/b c' }],
  ['/library/artist/ar-7', { view: 'artist', id: 'ar-7' }],
  ['/search', { view: 'search', q: '' }],
  ['/search?q=night+turns', { view: 'search', q: 'night turns' }],
  ['/settings', { view: 'settings', section: 'preferences' }],
  ['/settings/account', { view: 'settings', section: 'account' }],
  ['/__ui', { view: 'ui' }],
];

describe('parseRoute / routePath', () => {
  it.each(CANONICAL)('%s round-trips', (url, route) => {
    const u = new URL(url, 'http://echo.test');
    expect(parseRoute(u.pathname, u.search)).toEqual(route);
    expect(routePath(route)).toBe(url);
  });

  it.each([
    ['/library/albums', { view: 'library', tab: 'albums' }],
    ['/library/', { view: 'library', tab: 'albums' }],
    ['/settings/preferences', { view: 'settings', section: 'preferences' }],
    ['//search', { view: 'search', q: '' }],
  ] as [string, Route][])('accepts the non-canonical spelling %s', (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });

  it.each([
    '/nope',
    '/library/genres',
    '/library/album',
    '/library/album/x/extra',
    '/library/artist',
    '/library/artist/x/extra',
    '/settings/server',
    '/search/x',
    '/__ui/x',
    '/library/album/%E0%A4%A',
  ])('%s is not found', (path) => {
    expect(parseRoute(path)).toEqual({ view: 'notFound', path });
  });
});

describe('deterministic mode (?frame&seed&track&fixture&tier)', () => {
  it('parses every param and writes them back in canonical order', () => {
    const route = parseRoute('/', '?tier=T2&fixture=ballad&track=al-harbour-2&seed=7&frame=12000');
    expect(route).toEqual({
      view: 'listen',
      frame: { ms: 12000, seed: 7, track: 'al-harbour-2', fixture: 'ballad', tier: 'T2' },
    });
    expect(routePath(route)).toBe('/?frame=12000&seed=7&track=al-harbour-2&fixture=ballad&tier=T2');
  });

  it('keeps track and fixture apart: a track id is not a Features fixture', () => {
    expect(parseRoute('/', '?frame=1&track=al-harbour-2')).toEqual({
      view: 'listen',
      frame: { ms: 1, seed: 0, track: 'al-harbour-2' },
    });
    expect(parseRoute('/', '?frame=1&fixture=ballad')).toEqual({
      view: 'listen',
      frame: { ms: 1, seed: 0, fixture: 'ballad' },
    });
  });

  it('keeps unrelated params, in their order, after its own', () => {
    const route = parseRoute('/', '?debug=1&frame=5&x=a%20b&x=2');
    expect(route).toEqual({
      view: 'listen',
      frame: { ms: 5, seed: 0, other: 'debug=1&x=a+b&x=2' },
    });
    expect(routePath(route)).toBe('/?frame=5&debug=1&x=a+b&x=2');
  });

  it('defaults seed to 0 and leaves defaults out of the URL', () => {
    const route = parseRoute('/', '?frame=0');
    expect(route).toEqual({ view: 'listen', frame: { ms: 0, seed: 0 } });
    expect(routePath(route)).toBe('/?frame=0');
  });

  it('ignores a malformed frame; drops a malformed seed or tier and an empty track or fixture', () => {
    for (const q of ['?frame=', '?frame=-5', '?frame=1.5', '?frame=abc', '?frame=1e3', '?seed=3'])
      expect(parseRoute('/', q)).toEqual({ view: 'home' });
    for (const q of ['?track=al-harbour-2', '?fixture=ballad'])
      expect(parseRoute('/', q)).toEqual({ view: 'home' }); // no frame, no mode
    const route = parseRoute('/', '?frame=10&seed=x&tier=T9&track=&fixture=');
    expect(route).toEqual({ view: 'listen', frame: { ms: 10, seed: 0 } });
    expect(routePath(route)).toBe('/?frame=10');
  });

  it('survives the store canonicalising the URL on load, unrelated params included', () => {
    const f = fakeHost('/?frame=500&seed=2&track=al-harbour-2&fixture=ballad&debug=1');
    createViewStore(f.host);
    expect(f.url()).toBe('/?frame=500&seed=2&track=al-harbour-2&fixture=ballad&debug=1');
  });
});

describe('createViewStore', () => {
  it('starts from a deep link', () => {
    const { host } = fakeHost('/library/album/al-42');
    expect(createViewStore(host).getState().route).toEqual({ view: 'album', id: 'al-42' });
  });

  it('rewrites a non-canonical deep link in place, without a new entry', () => {
    const f = fakeHost('/library/albums');
    createViewStore(f.host);
    expect(f.entries).toEqual(['/library']);
  });

  it('keeps an unknown address as it is', () => {
    const f = fakeHost('/nope?x=1');
    expect(createViewStore(f.host).getState().route).toEqual({
      view: 'notFound',
      path: '/nope?x=1',
    });
    expect(f.entries).toEqual(['/nope?x=1']);
  });

  it('pushes on navigate and follows back/forward', () => {
    const f = fakeHost('/');
    const store = createViewStore(f.host);
    store.getState().navigate({ view: 'library', tab: 'albums' });
    store.getState().navigate({ view: 'album', id: 'al-1' });
    expect(f.entries).toEqual(['/', '/library', '/library/album/al-1']);

    f.back();
    expect(store.getState().route).toEqual({ view: 'library', tab: 'albums' });
    f.back();
    expect(store.getState().route).toEqual({ view: 'home' });
    f.forward();
    expect(store.getState().route).toEqual({ view: 'library', tab: 'albums' });
  });

  it('replaces when asked, and when re-selecting the current view', () => {
    const f = fakeHost('/');
    const store = createViewStore(f.host);
    store.getState().navigate({ view: 'search', q: 'n' });
    store.getState().navigate({ view: 'search', q: 'ni' }, { replace: true });
    store.getState().navigate({ view: 'search', q: 'ni' });
    expect(f.entries).toEqual(['/', '/search?q=ni']);
    expect(store.getState().route).toEqual({ view: 'search', q: 'ni' });
  });

  it('drops forward entries after navigating from the middle of history', () => {
    const f = fakeHost('/');
    const store = createViewStore(f.host);
    store.getState().navigate({ view: 'library', tab: 'albums' });
    f.back();
    store.getState().navigate({ view: 'settings', section: 'account' });
    expect(f.entries).toEqual(['/', '/settings/account']);
    expect(f.url()).toBe('/settings/account');
  });
});
