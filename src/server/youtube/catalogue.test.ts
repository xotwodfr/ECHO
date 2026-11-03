import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { type Catalogue, createCatalogue, likeStatusOf, YtSignedOut } from './catalogue.ts';
import { createFakeCatalogue } from './fake.ts';

// The catalogue against InnerTube answers recorded once from the live service (fixtures/, by
// scripts/record-youtube-fixtures.mjs): no test talks to YouTube.

const fx = JSON.parse(
  gunzipSync(readFileSync(new URL('./fixtures/innertube.json.gz', import.meta.url))).toString(),
) as {
  meta: { album: string; artist: string; playlist: string; song: string };
  responses: Record<string, { status: number; text: string }>;
};

const keyOf = (url: string, body?: string) => {
  const u = new URL(url);
  const b = (body ? JSON.parse(body) : {}) as Record<string, string | undefined>;
  return [
    u.pathname,
    b.browseId ?? '',
    b.query ?? b.input ?? '',
    b.videoId ?? '',
    b.params ?? '',
  ].join('|');
};

const replay = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const body =
    typeof init?.body === 'string'
      ? init.body
      : input instanceof Request && input.method === 'POST'
        ? await input.clone().text()
        : undefined;
  const hit = fx.responses[keyOf(url, body)];
  if (!hit) return new Response('{}', { status: 404 });
  return new Response(hit.text, {
    status: hit.status,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

const cat = () => createCatalogue({ fetch: replay });
const VIDEO = /^[\w-]{11}$/;

describe('the YouTube Music catalogue (recorded answers)', () => {
  it('maps song search', async () => {
    const page = await cat().search('bohemian rhapsody', 'songs');
    const first = page.shelves[0]?.items[0];
    expect(first?.kind).toBe('song');
    expect(first?.id).toMatch(VIDEO);
    expect(first?.title).toBeTruthy();
    expect(first?.track?.durationMs).toBeGreaterThan(0);
    expect(first?.track?.key).toBe(`youtube:${first?.id}`);
    expect(first?.thumb).toMatch(/^\/api\/v1\/youtube\/image\?u=https%3A%2F%2F/);
    expect(page.shelves.every((s) => s.items.every((i) => i.kind === 'song'))).toBe(true);
  });

  it('groups the all tab by kind', async () => {
    const page = await cat().search('bohemian rhapsody', 'all');
    const titles = page.shelves.map((s) => s.title);
    expect(titles).toContain('Songs');
    expect(titles.length).toBeGreaterThan(1);
  });

  it('maps an album page', async () => {
    const page = await cat().album(fx.meta.album);
    expect(page.title).toBeTruthy();
    expect(page.tracks?.length).toBeGreaterThan(0);
    for (const t of page.tracks ?? []) {
      expect(t.album.id).toBe(fx.meta.album);
      expect(t.artists.length).toBeGreaterThan(0);
      expect(t.artwork[0]?.url).toBeTruthy();
    }
  });

  it('maps an artist page', async () => {
    const page = await cat().artist(fx.meta.artist);
    expect(page.title).toBe('Queen');
    expect(page.tracks?.length).toBeGreaterThan(0);
    expect(page.shelves.find((s) => s.title === 'Top songs')?.layout).toBe('rows');
    expect(page.shelves.some((s) => s.items.some((i) => i.kind === 'album'))).toBe(true);
  });

  it('maps a playlist page', async () => {
    const page = await cat().playlist(fx.meta.playlist);
    expect(page.tracks?.length).toBeGreaterThan(10);
  });

  it('maps the home feed', async () => {
    const page = await cat().home();
    expect(page.shelves.length).toBeGreaterThan(0);
    // This recording's Home is all cards (the signed-out Home varies); rows: the artist test.
    expect(page.shelves.map((s) => s.title)).toEqual([
      'Take it easy',
      'The sound of autumn',
      'All hits',
    ]);
    expect(page.shelves.every((s) => s.layout === 'cards' && s.items.length > 0)).toBe(true);
  });

  it('maps up next', async () => {
    const up = await cat().upNext('fJ9rUzIMcZQ');
    expect(up.tracks.length).toBeGreaterThanOrEqual(20);
    expect(up.tracks.every((t) => t.durationMs > 0)).toBe(true);
  });

  it('maps lyrics', async () => {
    const l = await cat().lyrics('fJ9rUzIMcZQ');
    expect(l?.text.startsWith('Is this the real life')).toBe(true);
    expect(l?.source).toMatch(/Musixmatch|LyricFind/);
  });

  // Review 2026-11-03: the like button started unliked for every song; YouTube's answer says.
  it("reads a song's like from YouTube's answer", async () => {
    expect(await cat().liked('fJ9rUzIMcZQ')).toBe(false); // recorded: INDIFFERENT
    expect(likeStatusOf({ a: [{ likeButtonRenderer: { likeStatus: 'LIKE' } }] })).toBe(true);
    expect(likeStatusOf({ likeStatus: 'DISLIKE' })).toBe(false);
  });

  it('maps suggestions', async () => {
    expect((await cat().suggest('bohem')).length).toBeGreaterThan(0);
  });

  // Review 2026-11-03: a cookie Google rotated still answered Home (a general feed), so "Sign in to
  // YouTube Music again" never showed there. Every answer says logged_in; with a cookie, "0" is stale.
  it('a stale cookie is signed out on Home too', async () => {
    const stale = createCatalogue({ cookie: 'SAPISID=rotated', fetch: replay });
    await expect(stale.home()).rejects.toBeInstanceOf(YtSignedOut);
    await expect(stale.search('bohemian rhapsody', 'songs')).rejects.toBeInstanceOf(YtSignedOut);
    expect((await cat().home()).shelves.length).toBeGreaterThan(0); // without a cookie: fine
  });

  it('library without a cookie throws YtSignedOut', async () => {
    await expect(cat().library()).rejects.toBeInstanceOf(YtSignedOut);
    await expect(cat().account()).rejects.toBeInstanceOf(YtSignedOut);
  });
});

describe('the fake catalogue (development and E2E)', () => {
  it('answers every Catalogue method', async () => {
    const f: Catalogue = createFakeCatalogue({ cookie: 'SAPISID=x', audioBase: 'http://mock' });
    expect((await f.account()).name).toBe('Fixture Listener');
    const home = await f.home();
    expect(home.shelves.map((s) => s.title)).toEqual([
      'Quick picks',
      'Listen again',
      'Mixed for you',
    ]);
    const song = home.shelves[0]?.items[0];
    expect(song?.track?.provider).toBe('youtube');
    expect((await f.search('Fake Song 1', 'songs')).shelves[0]?.items.length).toBeGreaterThan(0);
    expect((await f.album('MPREb_fake1')).tracks?.length).toBeGreaterThan(0);
    expect((await f.artist('UCfakeartist1')).tracks?.length).toBeGreaterThan(0);
    expect((await f.playlist('VLfakeplaylist1')).tracks?.length).toBeGreaterThan(0);
    expect((await f.upNext('fakesong001')).tracks[0]?.id).toBe('fakesong001');
    expect((await f.related('fakesong001')).shelves.length).toBeGreaterThan(0);
    expect((await f.library()).shelves.length).toBeGreaterThan(0);
    expect(await f.suggest('fake')).toContain('fake song 1');
    expect(await f.lyrics('fakesong001')).toMatchObject({ source: 'Fixture' });
    await f.like('fakesong001', true);
    expect(await f.liked('fakesong001')).toBe(true);
    await f.played('fakesong001');
    expect((await f.explore()).shelves.length).toBeGreaterThan(0);
  });

  it('signed out, or with a stale cookie, the account parts refuse', async () => {
    const anon = createFakeCatalogue({ audioBase: 'http://mock' });
    await expect(anon.library()).rejects.toBeInstanceOf(YtSignedOut);
    const stale = createFakeCatalogue({ cookie: 'SAPISID=stale', audioBase: 'http://mock' });
    expect((await stale.account()).name).toBe('Fixture Listener');
    await expect(stale.library()).rejects.toBeInstanceOf(YtSignedOut);
  });

  it('its resolver points at the mock googlevideo, and one song will not play', async () => {
    const f = createFakeCatalogue({ audioBase: 'http://mock' });
    expect((await f.resolver.resolve('fakesong001')).url).toMatch(
      /^http:\/\/mock\/videoplayback\?id=fakesong001&expire=\d+$/,
    );
    await expect(f.resolver.resolve('unavailable')).rejects.toMatchObject({
      code: 'youtube.unavailable',
    });
  });
});
