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
  ['/', { view: 'listen' }],
  ['/library', { view: 'library', tab: 'albums' }],
  ['/library/artists', { view: 'library', tab: 'artists' }],
  ['/library/playlists', { view: 'library', tab: 'playlists' }],
  ['/library/starred', { view: 'library', tab: 'starred' }],
  ['/library/album/al-42', { view: 'album', id: 'al-42' }],
  ['/library/album/a%2Fb%20c', { view: 'album', id: 'a/b c' }],
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
    '/settings/admin',
    '/search/x',
    '/__ui/x',
    '/library/album/%E0%A4%A',
  ])('%s is not found', (path) => {
    expect(parseRoute(path)).toEqual({ view: 'notFound', path });
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
    expect(store.getState().route).toEqual({ view: 'listen' });
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
