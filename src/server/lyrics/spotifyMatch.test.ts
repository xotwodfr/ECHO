import { describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { openDb } from '../db/db.ts';
import { createApp } from '../index.ts';
import type { SubsonicClient } from '../navidrome/client.ts';
import { call, testDeps } from '../testing.ts';
import { type Source, spicySource } from './sources.ts';
import {
  createSpotifyMatcher,
  type MatchDeps,
  metaOf,
  parseSpotifyId,
  plainTitle,
} from './spotifyMatch.ts';

// Spotify matching for Navidrome tracks (LYRICS_INTEGRATION.md §4.3): on play, the library sweep,
// admin corrections, and how the matches reach Spicy and the lyrics cache.

const ID_A = '4uLU6hMCjMI75M1A2tKUQC';
const ID_B = '7GhIk7Il098yCjg4BQjzvb';
const ID_C = '0kPmcPPkjoyfLhUwHLWrk0';

const song = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `s${n}`,
  title: `Song ${n}`,
  artist: 'Band',
  album: 'Record',
  duration: 200,
  ...extra,
});

/** A Navidrome with these songs: getSong and paged search3. */
function library(songs: Record<string, unknown>[]) {
  const calls: { method: string; params: Record<string, string> }[] = [];
  const client = {
    call: async (method: string, params: Record<string, string> = {}) => {
      calls.push({ method, params });
      if (method === 'getSong') return { song: songs.find((s) => s.id === params.id) };
      const off = Number(params.songOffset);
      return { searchResult3: { song: songs.slice(off, off + Number(params.songCount)) } };
    },
    request: async () => {
      throw new Error('unused');
    },
  } as unknown as SubsonicClient;
  return { client, calls };
}

/** ListenBrainz, MusicBrainz and Spotify fakes, answering from tables. */
function web(t: {
  meta?: Record<string, string[]>; // title → ids
  mbid?: Record<string, string[]>; // recording mbid → ids
  isrc?: Record<string, string>; // ISRC → recording mbid
  spotify?: Record<string, { id: string; name: string; duration_ms: number }[]>; // q → items
  fail?: boolean;
}) {
  const urls: string[] = [];
  const f = (async (u: string | URL, init?: RequestInit) => {
    const url = String(u);
    urls.push(url);
    if (t.fail) return new Response('{}', { status: 503 });
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.includes('/spotify-id-from-metadata/'))
      return Response.json(
        body.map((x: { track_name: string }) => ({
          spotify_track_ids: t.meta?.[x.track_name] ?? [],
        })),
      );
    if (url.includes('/spotify-id-from-mbid/'))
      return Response.json(
        body.map((x: { recording_mbid: string }) => ({
          spotify_track_ids: t.mbid?.[x.recording_mbid] ?? [],
        })),
      );
    if (url.includes('/ws/2/isrc/')) {
      const isrc = url.split('/ws/2/isrc/')[1]?.split('?')[0] ?? '';
      const m = t.isrc?.[isrc];
      return m ? Response.json({ recordings: [{ id: m }] }) : new Response('{}', { status: 404 });
    }
    if (url.includes('/v1/search')) {
      const q = new URL(url).searchParams.get('q') ?? '';
      return Response.json({ tracks: { items: t.spotify?.[q] ?? [] } });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, urls };
}

function matcher(over: Partial<MatchDeps> & { fetch: typeof fetch }) {
  const db = openDb(':memory:');
  const m = createSpotifyMatcher({
    db,
    now: () => 1_800_000_000_000,
    listenbrainzUrl: 'https://lb.test',
    musicbrainzUrl: 'https://mb.test',
    spotifyApiUrl: 'https://api.spotify.test',
    userAgent: 'ECHO/test',
    spotifyAppToken: async () => null,
    libraries: async () => [],
    sweepEnabled: () => true,
    sleep: async () => {},
    ...over,
  });
  return { m, db };
}

describe('parsing', () => {
  it('a Spotify id from an id, URI or link; anything else is null', () => {
    expect(parseSpotifyId(ID_A)).toBe(ID_A);
    expect(parseSpotifyId(`spotify:track:${ID_A}`)).toBe(ID_A);
    expect(parseSpotifyId(` https://open.spotify.com/intl-de/track/${ID_A}?si=x `)).toBe(ID_A);
    expect(parseSpotifyId('https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC')).toBeNull();
    expect(parseSpotifyId('nope')).toBeNull();
  });

  it('plain titles drop credits and same-recording tags, never remix, live or demo', () => {
    expect(plainTitle('Wolves (feat. Caroline Shaw & Frank Ocean)')).toBe('Wolves');
    expect(plainTitle('Won’t Stop (Album Version) [Explicit]')).toBe('Won’t Stop');
    expect(plainTitle('Out of Time (2009 Remaster)')).toBe('Out of Time');
    expect(plainTitle('Hymn for the Weekend (Seeb Remix)')).toBe(
      'Hymn for the Weekend (Seeb Remix)',
    );
    expect(plainTitle('Intro (Live Version)')).toBe('Intro (Live Version)');
    expect(plainTitle('Ride (Demo 4)')).toBe('Ride (Demo 4)');
  });

  it('a Subsonic song: ISRC upper-cased (first of a list), seconds to ms', () => {
    expect(metaOf({ ...song(1), isrc: ['gbaye0601498'], musicBrainzId: 'mb-1' })).toEqual({
      id: 's1',
      title: 'Song 1',
      artist: 'Band',
      album: 'Record',
      durationMs: 200_000,
      isrc: 'GBAYE0601498',
      mbid: 'mb-1',
    });
  });
});

describe('on play', () => {
  it('matches from Navidrome’s own metadata, stores it, and answers from storage next time', async () => {
    const lib = library([song(1)]);
    const w = web({ meta: { 'Song 1': [ID_A, ID_B] } });
    const { m } = matcher({ fetch: w.f });
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([ID_A, ID_B]);
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([ID_A, ID_B]);
    expect(lib.calls.map((c) => c.method)).toEqual(['getSong']);
    expect(w.urls).toHaveLength(1);
    expect(m.match('nd', 's1')).toMatchObject({ method: 'lb-meta', tried: ['lb-meta'] });
  });

  it('with the app’s Spotify token, Spotify’s ISRC search comes first', async () => {
    const lib = library([song(1, { isrc: 'GBAYE0601498' })]);
    const w = web({
      meta: { 'Song 1': [ID_B] },
      spotify: { 'isrc:GBAYE0601498': [{ id: ID_A, name: 'Song 1', duration_ms: 200_000 }] },
    });
    const { m } = matcher({ fetch: w.f, spotifyAppToken: async () => 'app-token' });
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([ID_A]);
    expect(w.urls.some((u) => u.includes('lb.test'))).toBe(false);
  });

  it('Spotify’s metadata search keeps only the right length and title', async () => {
    const lib = library([song(1)]);
    const w = web({
      spotify: {
        'track:"Song 1" artist:"Band"': [
          { id: ID_B, name: 'Song 1', duration_ms: 260_000 }, // another version
          { id: ID_A, name: 'Song 1', duration_ms: 201_000 },
        ],
      },
    });
    const { m } = matcher({ fetch: w.f, spotifyAppToken: async () => 'app-token' });
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([ID_A]);
  });

  it('a ListenBrainz miss is asked again with the plain title', async () => {
    const lib = library([song(1, { title: 'Wolves (feat. Frank Ocean)' })]);
    const w = web({ meta: { Wolves: [ID_C] } });
    const { m } = matcher({ fetch: w.f });
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([ID_C]);
    expect(w.urls).toHaveLength(2);
  });

  it('a failure matches nothing and is not remembered as "none"', async () => {
    const lib = library([song(1)]);
    const { m } = matcher({ fetch: web({ fail: true }).f });
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([]);
    expect(m.match('nd', 's1')?.tried).toEqual([]);
  });

  it('a track ListenBrainz missed before the client secret was saved is asked of Spotify', async () => {
    const lib = library([song(1)]);
    const w = web({
      spotify: {
        'track:"Song 1" artist:"Band"': [{ id: ID_A, name: 'Song 1', duration_ms: 200_000 }],
      },
    });
    let token: string | null = null;
    const { m } = matcher({ fetch: w.f, spotifyAppToken: async () => token });
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([]);
    token = 'app-token';
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([ID_A]);
  });

  it('Spotify busy (429): ListenBrainz still answers, and Spotify is asked again next time', async () => {
    const lib = library([song(1)]);
    const inner = web({ meta: { 'Song 1': [ID_B] } });
    const f = (async (u: string, init?: RequestInit) =>
      String(u).includes('/v1/search')
        ? new Response('{}', { status: 429 })
        : inner.f(u, init)) as unknown as typeof fetch;
    const { m } = matcher({ fetch: f, spotifyAppToken: async () => 'app-token' });
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([ID_B]);
    expect(m.match('nd', 's1')?.tried).toEqual(['lb-meta']);
  });
});

describe('the library sweep', () => {
  it('pages the library, batches ListenBrainz, then MusicBrainz for what has an ISRC', async () => {
    const songs = Array.from({ length: 650 }, (_, i) => song(i));
    songs[3] = song(3, { isrc: 'USRC17607839' });
    songs[4] = song(4, { musicBrainzId: 'mb-4' });
    const lib = library(songs);
    const w = web({
      meta: { 'Song 0': [ID_A], 'Song 1': [ID_B] },
      isrc: { USRC17607839: 'mb-3' },
      mbid: { 'mb-3': [ID_C] },
    });
    const { m } = matcher({
      fetch: w.f,
      libraries: async () => [{ scope: 'nd', client: lib.client }],
    });
    await m.sweep();
    expect(lib.calls.map((c) => c.params.songOffset)).toEqual(['0', '500']);
    expect(w.urls.filter((u) => u.includes('from-metadata'))).toHaveLength(7); // 500/100 + 150/100
    expect(w.urls.filter((u) => u.includes('/ws/2/isrc/'))).toEqual([
      'https://mb.test/ws/2/isrc/USRC17607839?fmt=json',
    ]); // s4 already has its recording id
    expect(m.match('nd', 's3')).toMatchObject({ ids: [ID_C], method: 'lb-mbid' });
    expect(m.counts('nd')).toEqual({ tracks: 650, matched: 3, manual: 0, none: 647, pending: 0 });
    expect(m.status()).toMatchObject({ running: false, scanned: 650, error: null });

    // A second sweep asks nothing again.
    const before = w.urls.length;
    await m.sweep();
    expect(w.urls.length).toBe(before);
  });

  it('MusicBrainz busy (503): retried with backoff; a track it keeps refusing waits for the next run', async () => {
    const songs = [song(1, { isrc: 'AAAAA0000001' }), song(2, { isrc: 'AAAAA0000002' })];
    const lib = library(songs);
    const inner = web({ isrc: { AAAAA0000002: 'mb-2' }, mbid: { 'mb-2': [ID_A] } });
    let busy = 0;
    const slept: number[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      if (String(u).includes('AAAAA0000001')) return new Response('{}', { status: 503 });
      if (String(u).includes('AAAAA0000002') && busy++ < 1)
        return new Response('{}', { status: 503, headers: { 'retry-after': '3' } });
      return inner.f(u, init);
    }) as unknown as typeof fetch;
    const { m } = matcher({
      fetch: f,
      libraries: async () => [{ scope: 'nd', client: lib.client }],
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await m.sweep();
    expect(slept).toContain(3000); // its Retry-After
    expect(slept).toEqual(expect.arrayContaining([2000, 4000, 8000, 16000]));
    expect(m.match('nd', 's2')).toMatchObject({ ids: [ID_A], method: 'lb-mbid' });
    expect(m.match('nd', 's1')?.tried).not.toContain('lb-mbid');
    expect(m.status().error).toBeNull();
  });

  it('a server that repeats the same page forever ends the pass (security review)', async () => {
    let calls = 0;
    const page = Array.from({ length: 500 }, (_, i) => song(i));
    const client = {
      call: async () => {
        calls++;
        return { searchResult3: { song: page } };
      },
    } as unknown as SubsonicClient;
    const { m } = matcher({ fetch: web({}).f, libraries: async () => [{ scope: 'nd', client }] });
    await m.sweep();
    expect(calls).toBe(2);
    expect(m.counts('nd').tracks).toBe(500);
  });

  it('switched off in Admin, it does not run; an error stops it and is reported', async () => {
    const lib = library([song(1)]);
    const off = matcher({
      fetch: web({}).f,
      sweepEnabled: () => false,
      libraries: async () => [{ scope: 'nd', client: lib.client }],
    });
    await off.m.sweep();
    expect(lib.calls).toHaveLength(0);
    const broken = matcher({
      fetch: web({ fail: true }).f,
      libraries: async () => [{ scope: 'nd', client: lib.client }],
    });
    await broken.m.sweep();
    expect(broken.m.status().error).toContain('listenbrainz 503');
  });

  it('Spotify busy (429): the track waits for the next run; ListenBrainz still runs', async () => {
    const lib = library([song(1), song(2)]);
    const inner = web({ meta: { 'Song 2': [ID_B] } });
    const f = (async (u: string, init?: RequestInit) =>
      String(u).includes('/v1/search')
        ? new Response('{}', { status: 429, headers: { 'retry-after': '5' } })
        : inner.f(u, init)) as unknown as typeof fetch;
    const { m } = matcher({
      fetch: f,
      spotifyAppToken: async () => 'app-token',
      libraries: async () => [{ scope: 'nd', client: lib.client }],
    });
    await m.sweep();
    expect(m.status().error).toBeNull();
    expect(m.match('nd', 's2')).toMatchObject({ ids: [ID_B], method: 'lb-meta' });
    expect(m.match('nd', 's1')?.tried).not.toContain('spotify');
  });

  it('a short Retry-After is waited out, then Spotify is asked about the next track', async () => {
    const lib = library([song(1), song(2)]);
    let busy = 0;
    const f = (async (u: string, init?: RequestInit) => {
      if (!String(u).includes('/v1/search')) return web({}).f(u, init);
      if (busy++ < 1) return new Response('{}', { status: 429, headers: { 'retry-after': '5' } });
      return Response.json({
        tracks: { items: [{ id: ID_A, name: 'Song 2', duration_ms: 200_000 }] },
      });
    }) as unknown as typeof fetch;
    const slept: number[] = [];
    const { m } = matcher({
      fetch: f,
      spotifyAppToken: async () => 'app-token',
      libraries: async () => [{ scope: 'nd', client: lib.client }],
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await m.sweep();
    expect(slept).toContain(5000);
    expect(m.match('nd', 's2')).toMatchObject({ ids: [ID_A], method: 'spotify' });
  });

  it('a long Retry-After, or ten failures in a row, leaves Spotify for the next run', async () => {
    const songs = Array.from({ length: 12 }, (_, i) => song(i));
    const run = async (res: () => Response) => {
      const w = web({});
      const f = (async (u: string, init?: RequestInit) =>
        String(u).includes('/v1/search') ? res() : w.f(u, init)) as unknown as typeof fetch;
      const { m } = matcher({
        fetch: f,
        spotifyAppToken: async () => 'app-token',
        libraries: async () => [{ scope: 'nd', client: library(songs).client }],
      });
      await m.sweep();
      expect(m.status().error).toBeNull();
      return w.urls.filter((u) => u.includes('lb.test')).length > 0; // ListenBrainz still ran
    };
    let searches = 0;
    const count = (r: Response) => () => {
      searches++;
      return r.clone();
    };
    const penalty = new Response('{}', { status: 429, headers: { 'retry-after': '3600' } });
    expect(await run(count(penalty))).toBe(true);
    expect(searches).toBe(1);
    searches = 0;
    expect(await run(count(new Response('{}', { status: 503 })))).toBe(true);
    expect(searches).toBe(10);
  });

  it('the log says why Spotify was left, with Spotify’s own words', async () => {
    const logs: { msg: string; extra?: Record<string, unknown> }[] = [];
    const w = web({});
    const f = (async (u: string, init?: RequestInit) =>
      String(u).includes('/v1/search')
        ? new Response('{"error":{"status":429,"message":"API rate limit exceeded"}}', {
            status: 429,
            headers: { 'retry-after': '68167' },
          })
        : w.f(u, init)) as unknown as typeof fetch;
    const { m } = matcher({
      fetch: f,
      log: (_level, msg, extra) => logs.push({ msg, extra }),
      spotifyAppToken: async () => 'app-token',
      libraries: async () => [{ scope: 'nd', client: library([song(1), song(2)]).client }],
    });
    await m.sweep();
    expect(logs.find((l) => l.msg.includes('leaving Spotify'))?.extra).toMatchObject({
      failures: 1,
      retryAfterS: 68167,
      detail: 'spotify search 429',
    });
  });

  it('a refused app token is asked for once per run, and the log says so', async () => {
    const logs: string[] = [];
    let tokens = 0;
    const { m } = matcher({
      fetch: web({}).f as unknown as typeof fetch,
      log: (_level, msg) => logs.push(msg),
      spotifyAppToken: async () => {
        tokens++;
        return null;
      },
      // Two pages of songs: before, the token was asked for again on every page.
      libraries: async () => [
        { scope: 'nd', client: library(Array.from({ length: 501 }, (_, i) => song(i))).client },
      ],
    });
    await m.sweep();
    expect(tokens).toBe(1);
    expect(logs.filter((l) => l.includes('no app token'))).toHaveLength(1);
  });

  it('an app token that expires during the sweep is renewed', async () => {
    const lib = library([song(1), song(2), song(3)]);
    let searches = 0;
    const live = () => `t${Math.floor(searches / 2)}`; // a new token every two searches
    const f = (async (u: string, init?: RequestInit) => {
      if (!String(u).includes('/v1/search')) return web({}).f(u, init);
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (auth !== `Bearer ${live()}`) return new Response('{}', { status: 401 });
      searches++;
      const name = /track:"([^"]+)"/.exec(new URL(String(u)).searchParams.get('q') ?? '')?.[1];
      return Response.json({ tracks: { items: [{ id: ID_A, name, duration_ms: 200_000 }] } });
    }) as unknown as typeof fetch;
    const { m } = matcher({
      fetch: f,
      spotifyAppToken: async () => live(),
      libraries: async () => [{ scope: 'nd', client: lib.client }],
    });
    await m.sweep();
    expect(m.counts('nd')).toMatchObject({ matched: 3, none: 0 });
  });

  it('Spotify is asked only for tracks with no match yet', async () => {
    const lib = library([song(1), song(2)]);
    const w = web({ meta: { 'Song 1': [ID_A] } });
    let token: string | null = null;
    const { m } = matcher({
      fetch: w.f,
      spotifyAppToken: async () => token,
      libraries: async () => [{ scope: 'nd', client: lib.client }],
    });
    await m.sweep(); // before the client secret: ListenBrainz matches Song 1 only
    token = 'app-token';
    await m.sweep();
    const asked = w.urls
      .filter((u) => u.includes('/v1/search'))
      .map((u) => new URL(u).searchParams.get('q'));
    expect(asked).toEqual(['track:"Song 2" artist:"Band"']);
  });
});

describe('corrections', () => {
  it('a manual match wins over every matcher and survives the sweep; null forgets it', async () => {
    const lib = library([song(1)]);
    const w = web({ meta: { 'Song 1': [ID_B] } });
    const { m } = matcher({
      fetch: w.f,
      libraries: async () => [{ scope: 'nd', client: lib.client }],
    });
    m.setManual('nd', 's1', ID_A);
    await m.sweep();
    expect(m.match('nd', 's1')).toMatchObject({ ids: [ID_A], method: 'manual' });
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([ID_A]);
    m.setManual('nd', 's1', null);
    expect(await m.idsFor('nd', 's1', async () => lib.client)).toEqual([ID_B]);
  });

  it('misses list only tracks tried without a match', async () => {
    const lib = library([song(1), song(2)]);
    const w = web({ meta: { 'Song 1': [ID_A] } });
    const { m } = matcher({
      fetch: w.f,
      libraries: async () => [{ scope: 'nd', client: lib.client }],
    });
    await m.sweep();
    expect(m.misses('nd', 0, 50)).toEqual([
      { id: 's2', title: 'Song 2', artist: 'Band', album: 'Record', isrc: null },
    ]);
  });
});

describe('Spicy with several ids', () => {
  it('tries the next release’s id on a 404, at most three', async () => {
    const asked: string[] = [];
    const f = (async (url: string) => {
      asked.push(url.split('/').pop() as string);
      return url.endsWith(ID_C)
        ? Response.json({ Body: { Type: 'Static', Lines: [{ Text: 'hi' }] } })
        : new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const s = spicySource({ baseUrl: 'https://spicy.test', key: () => 'k', fetch: f });
    const o = await s.fetch(
      {
        trackKey: 'navidrome:s1',
        title: 'T',
        artist: 'A',
        spotifyId: ID_A,
        spotifyAlt: [ID_B, ID_C],
      },
      new AbortController().signal,
    );
    expect(asked).toEqual([ID_A, ID_B, ID_C]);
    expect(o.kind).toBe('found');
  });
});

describe('the lyrics route and Admin → Spotify matching', () => {
  function setup(role: 'admin' | 'user') {
    const t = testDeps();
    const db = t.deps.auth.db;
    const uid = Number(
      db
        .prepare(
          `INSERT INTO users (username, password_hash, role, created_at, totp_enabled) VALUES ('ada', 'x', ?, 0, 1)`,
        )
        .run(role).lastInsertRowid,
    );
    const lib = library([song(1)]);
    const w = web({ meta: { 'Song 1': [ID_A] } });
    const m = createSpotifyMatcher({
      db,
      now: () => t.clock.t,
      listenbrainzUrl: 'https://lb.test',
      musicbrainzUrl: 'https://mb.test',
      spotifyApiUrl: 'https://api.spotify.test',
      userAgent: 'ECHO/test',
      spotifyAppToken: async () => null,
      libraries: async () => [{ scope: 'none', client: lib.client }],
      sweepEnabled: () => true,
      sleep: async () => {},
      fetch: w.f,
    });
    const seen: (string | undefined)[] = [];
    const spicy: Source = {
      id: 'spicy',
      timeoutMs: 1000,
      retryAfterMs: null,
      metadataKeyed: false,
      eligible: (i) => !!i.spotifyId,
      fetch: async (i) => {
        seen.push(i.spotifyId);
        return {
          kind: 'found',
          candidate: {
            source: 'spicy',
            sync: 'line',
            offsetMs: 0,
            attribution: { text: 'x' },
            lines: [{ text: String(i.spotifyId), start: 1000 }],
          },
        };
      },
    };
    t.deps.lyrics.sourcesFor = () => [spicy];
    t.deps.lyrics.matcher = m;
    t.deps.lyrics.spotifyIdsFor = (_u, scope, id) => m.idsFor(scope, id, async () => lib.client);
    const app = createApp(t.deps);
    const cookie = `__Host-echo_session=${createSession(db, uid, 'web', t.clock.t)}`;
    const req = (method: string, path: string, body?: unknown) =>
      call(app, method, `/api/v1${path}`, body, cookie);
    return { req, seen, lib };
  }

  it('Spicy gets the stored match; the request’s own metadata cannot choose it', async () => {
    const s = setup('user');
    const r = await s.req(
      'GET',
      '/lyrics?trackKey=navidrome:s1&title=Forged&artist=Other&isrc=XXAAA0000001',
    );
    expect((await r.json()).doc.lines[0].text).toBe(ID_A);
    expect(s.lib.calls.map((c) => c.method)).toEqual(['getSong']);
  });

  it('a correction gives the track a fresh lookup with the new id', async () => {
    const s = setup('admin');
    const q = '/lyrics?trackKey=navidrome:s1&title=Song+1&artist=Band';
    expect((await (await s.req('GET', q)).json()).doc.lines[0].text).toBe(ID_A);
    const bad = await s.req('PUT', '/admin/spotify-matching/tracks/s1', { spotify: 'nope' });
    expect(bad.status).toBe(400);
    const ok = await s.req('PUT', '/admin/spotify-matching/tracks/s1', {
      spotify: `https://open.spotify.com/track/${ID_B}`,
    });
    expect(await ok.json()).toMatchObject({ match: { ids: [ID_B], method: 'manual' } });
    expect((await (await s.req('GET', q)).json()).doc.lines[0].text).toBe(ID_B);
    expect(s.seen).toEqual([ID_A, ID_B]);
  });

  it('progress, run and misses for admins; others are refused', async () => {
    const a = setup('admin');
    expect((await a.req('POST', '/admin/spotify-matching/run')).status).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(await (await a.req('GET', '/admin/spotify-matching')).json()).toMatchObject({
      counts: { tracks: 1, matched: 1 },
      status: { running: false },
    });
    expect(await (await a.req('GET', '/admin/spotify-matching/misses')).json()).toEqual([]);
    const u = setup('user');
    expect((await u.req('GET', '/admin/spotify-matching')).status).toBe(403);
    expect(
      (await u.req('PUT', '/admin/spotify-matching/tracks/s1', { spotify: ID_A })).status,
    ).toBe(403);
  });

  it('the client secret is write-only and checked', async () => {
    const a = setup('admin');
    const bad = await a.req('PUT', '/admin/settings', { spotify: { clientSecret: 'short' } });
    expect(bad.status).toBe(400);
    const r = await a.req('PUT', '/admin/settings', {
      spotify: { clientSecret: 'ab'.repeat(16), matchLibrary: false },
    });
    const body = await r.json();
    expect(body.spotify).toMatchObject({ clientSecretSaved: true, matchLibrary: false });
    expect(JSON.stringify(body)).not.toContain('ab'.repeat(16));
  });
});
