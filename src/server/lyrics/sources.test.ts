import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { createClient } from '../navidrome/client.ts';
import { type MockSubsonic, startMockSubsonic } from '../navidrome/mock.ts';
import { call, testDeps } from '../testing.ts';
import {
  lrclibSource,
  navidromePlainSource,
  navidromeSource,
  neteaseSource,
  spicyAttribution,
  spicySource,
} from './sources.ts';

// LYRICS_INTEGRATION.md §1, §6, §8: each source's answers, against fakes and the mock Navidrome.

// Fake keys, assembled so a secret scanner does not read them as real ones.
const FAKE_PK_0 = ['sl', 'pk', 'public12'].join('_');
const FAKE_SK_1 = ['sl', 'sk', 'secret'].join('_');
const FAKE_SK_2 = ['sl', 'sk', 'secret123'].join('_');
const FAKE_SK_3 = ['sl', 'sk', 'x1234567'].join('_');
const signal = new AbortController().signal;
const input = {
  trackKey: 'navidrome:al-1-t1',
  title: 'Harbour Lights 1',
  artist: 'Lowfield',
  album: 'Harbour Lights',
  durationMs: 200_000,
};

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('S3 LRCLIB', () => {
  const synced = {
    trackName: 'Harbour Lights 1',
    artistName: 'Lowfield',
    duration: 201,
    syncedLyrics: '[00:01.00]One\n[00:03.00]Two',
    plainLyrics: 'One\nTwo',
  };

  it('asks by metadata and duration with its User-Agent; synced lyrics are line-timed', async () => {
    const { f, calls } = fakeFetch(200, synced);
    const s = lrclibSource({
      baseUrl: 'https://lrclib.test',
      userAgent: 'ECHO/1 (+repo)',
      fetch: f,
    });
    const o = await s.fetch(input, signal);
    expect(calls[0]?.url).toBe(
      'https://lrclib.test/api/get?track_name=Harbour+Lights+1&artist_name=Lowfield&album_name=Harbour+Lights&duration=200',
    );
    expect((calls[0]?.init?.headers as Record<string, string> | undefined)?.['User-Agent']).toBe(
      'ECHO/1 (+repo)',
    );
    expect(o).toMatchObject({
      kind: 'found',
      candidate: {
        sync: 'line',
        source: 'lrclib',
        reportedDurationMs: 201_000,
        attribution: { text: 'Lyrics from LRCLIB' },
      },
    });
  });

  it('plain only, instrumental, 404 and 5xx', async () => {
    const plain = await lrclibSource({
      baseUrl: 'x',
      userAgent: 'u',
      fetch: fakeFetch(200, { ...synced, syncedLyrics: null }).f,
    }).fetch(input, signal);
    expect(plain).toMatchObject({ kind: 'found', candidate: { sync: 'none' } });
    const inst = await lrclibSource({
      baseUrl: 'x',
      userAgent: 'u',
      fetch: fakeFetch(200, { instrumental: true }).f,
    }).fetch(input, signal);
    expect(inst).toEqual({ kind: 'notFound' });
    expect(
      await lrclibSource({ baseUrl: 'x', userAgent: 'u', fetch: fakeFetch(404, {}).f }).fetch(
        input,
        signal,
      ),
    ).toEqual({ kind: 'notFound' });
    expect(
      await lrclibSource({ baseUrl: 'x', userAgent: 'u', fetch: fakeFetch(503, {}).f }).fetch(
        input,
        signal,
      ),
    ).toMatchObject({ kind: 'error', retriable: true });
  });
});

describe('S3 LRCLIB search fallback', () => {
  it('an exact miss searches; the synced record nearest in length wins, outside 3 s none', async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      if (url.includes('/api/get')) return new Response('{}', { status: 404 });
      return Response.json([
        {
          trackName: 'Harbour Lights 1',
          artistName: 'Lowfield',
          duration: 230,
          syncedLyrics: '[00:01.00]Far',
        },
        {
          trackName: 'Harbour Lights 1',
          artistName: 'Lowfield',
          duration: 201,
          plainLyrics: 'Plain',
        },
        {
          trackName: 'Harbour Lights 1',
          artistName: 'Lowfield',
          duration: 199,
          syncedLyrics: '[00:01.00]Near',
        },
      ]);
    }) as unknown as typeof fetch;
    const o = await lrclibSource({
      baseUrl: 'https://lrclib.test',
      userAgent: 'u',
      fetch: f,
    }).fetch(input, signal);
    expect(urls[1]).toBe(
      'https://lrclib.test/api/search?track_name=Harbour+Lights+1&artist_name=Lowfield',
    );
    expect(o).toMatchObject({
      kind: 'found',
      candidate: { sync: 'line', lines: [{ text: 'Near' }] },
    });
  });

  // ON-LY-2: a failing search was read as "not found", which is cached for 3 days.
  it('a search that fails is an error, not "not found"', async () => {
    const f = (async (url: string) =>
      url.includes('/api/get')
        ? new Response('{}', { status: 404 })
        : new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const o = await lrclibSource({ baseUrl: 'x', userAgent: 'u', fetch: f }).fetch(input, signal);
    expect(o).toMatchObject({ kind: 'error', retriable: true, detail: 'HTTP 503' });
  });
});

describe('S5 NetEase Cloud Music', () => {
  const route = (lyric: unknown, songs?: unknown[]) => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      if (url.includes('/api/search/get'))
        return Response.json({
          result: {
            songs: songs ?? [
              {
                id: 1,
                name: 'Harbour Lights 1',
                duration: 260_000,
                artists: [{ name: 'Lowfield' }],
              },
              { id: 2, name: 'Other Song', duration: 200_000, artists: [{ name: 'Lowfield' }] },
              {
                id: 3,
                name: 'Harbour Lights 1',
                duration: 201_000,
                artists: [{ name: 'Lowfield' }],
              },
            ],
          },
        });
      return Response.json(lyric);
    }) as unknown as typeof fetch;
    return { f, urls };
  };

  it('searches, keeps the title match of the right length, and reads word-timed YRC', async () => {
    const { f, urls } = route({ yrc: { lyric: '[1000,800](1000,400,0)Hello (1400,400,0)there' } });
    const o = await neteaseSource({ baseUrl: 'https://ne.test', fetch: f }).fetch(input, signal);
    expect(urls[1]).toBe('https://ne.test/api/song/lyric/v1?id=3&lv=1&yv=1');
    expect(o).toMatchObject({
      kind: 'found',
      candidate: {
        source: 'netease',
        sync: 'word',
        reportedDurationMs: 201_000,
        matched: { title: 'Harbour Lights 1', artist: 'Lowfield' },
        lines: [{ text: 'Hello there' }],
      },
    });
  });

  it('no YRC: line-timed LRC without credits; instrumentals and no match are not found', async () => {
    const lrc = route({
      lrc: { lyric: '[00:00.00] 作词 : Someone\n[00:01.00]One\n[00:02.00]Two' },
    });
    const o = await neteaseSource({ baseUrl: 'x', fetch: lrc.f }).fetch(input, signal);
    expect(o).toMatchObject({
      kind: 'found',
      candidate: { sync: 'line', lines: [{ text: 'One' }, { text: 'Two' }] },
    });
    const inst = route({ lrc: { lyric: '[00:00.00]纯音乐，请欣赏' } });
    expect(await neteaseSource({ baseUrl: 'x', fetch: inst.f }).fetch(input, signal)).toEqual({
      kind: 'notFound',
    });
    const none = route({}, [{ id: 9, name: 'Something Else', duration: 200_000 }]);
    expect(await neteaseSource({ baseUrl: 'x', fetch: none.f }).fetch(input, signal)).toEqual({
      kind: 'notFound',
    });
    expect(none.urls).toHaveLength(1);
  });
});

describe('S2 Spicy Lyrics', () => {
  const body = {
    Type: 'Line',
    id: '4cOdK2wGLETKBW3PvgPWqT',
    source: 'spicy_lyrics',
    SongWriters: ['A Writer'],
    EndTime: 180,
    UploadAttribution: {
      Uploader: { id: '1', username: 'up', url: 'https://spicylyrics.org/uid/1' },
      Maker: { id: '2', username: 'mk', url: 'https://spicylyrics.org/uid/2' },
    },
    Content: [{ Type: 'Vocal', Text: 'Hello', StartTime: 1, EndTime: 2 }],
  };
  const withId = { ...input, spotifyId: '4cOdK2wGLETKBW3PvgPWqT' };

  it('needs a key and a Spotify id; sends the key as a bearer token, server-side', async () => {
    const { f, calls } = fakeFetch(200, { Body: body, Status: 200, Type: 'object' });
    const keyed = spicySource({
      baseUrl: 'https://spicy.test',
      key: () => FAKE_SK_1,
      fetch: f,
    });
    expect(keyed.eligible(input)).toBe(false); // no Spotify id
    expect(keyed.eligible({ ...input, spotifyId: 'not-an-id' })).toBe(false);
    expect(spicySource({ baseUrl: 'x', key: () => null, fetch: f }).eligible(withId)).toBe(false);
    const o = await keyed.fetch(withId, signal);
    expect(calls[0]?.url).toBe('https://spicy.test/v1/lyrics/4cOdK2wGLETKBW3PvgPWqT');
    expect((calls[0]?.init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      `Bearer ${FAKE_SK_1}`,
    );
    expect(o).toMatchObject({
      kind: 'found',
      candidate: { source: 'spicy', sync: 'line', reportedDurationMs: 180_000 },
    });
  });

  it('attribution: community syncs credit maker and uploader; catalogues only the provider', () => {
    expect(spicyAttribution(body as never)).toEqual({
      text: 'Lyrics from Spicy Lyrics · synced by mk · uploaded by up · Written by A Writer',
      links: [
        { label: 'Spicy Lyrics', href: 'https://spicylyrics.org' },
        { label: 'mk', href: 'https://spicylyrics.org/uid/2' },
        { label: 'up', href: 'https://spicylyrics.org/uid/1' },
      ],
    });
    const apple = spicyAttribution({ Type: 'Syllable', source: 'apple_music' } as never);
    expect(apple.text).toBe('Lyrics from Apple Music via Spicy Lyrics');
    expect(apple.text).not.toMatch(/uploaded|synced by/);
  });

  it('attribution: a non-web maker or uploader URL is credited without a link', () => {
    const a = spicyAttribution({
      Type: 'Line',
      UploadAttribution: {
        Maker: { username: 'mk', url: 'javascript:alert(1)' },
        Uploader: { username: 'up', url: 'not a url' },
      },
    } as never);
    expect(a.text).toContain('synced by mk · uploaded by up');
    expect(a.links).toEqual([{ label: 'Spicy Lyrics', href: 'https://spicylyrics.org' }]);
  });

  it('404 is not found; 429 carries Retry-After; other 4xx are not retried', async () => {
    const s = (st: number, h = {}) =>
      spicySource({
        baseUrl: 'x',
        key: () => 'k',
        fetch: fakeFetch(st, { Body: { error: 'e' } }, h).f,
      }).fetch(withId, signal);
    expect(await s(404)).toEqual({ kind: 'notFound' });
    expect(await s(429, { 'retry-after': '30' })).toMatchObject({
      kind: 'error',
      retriable: false,
      retryAfterMs: 30_000,
    });
    expect(await s(401)).toMatchObject({ kind: 'error', retriable: false });
    expect(await s(502)).toMatchObject({ kind: 'error', retriable: true });
    // ON-LY-8: a 429 cools even without a number: an HTTP date, none at all (a minute), at most 1 h.
    const date = new Date(Date.now() + 120_000).toUTCString();
    const byDate = (await s(429, { 'retry-after': date })) as { retryAfterMs: number };
    expect(byDate.retryAfterMs).toBeGreaterThan(110_000);
    expect(byDate.retryAfterMs).toBeLessThanOrEqual(120_000);
    expect(await s(429)).toMatchObject({ retryAfterMs: 60_000 });
    expect(await s(429, { 'retry-after': '86400' })).toMatchObject({ retryAfterMs: 3_600_000 });
  });
});

describe('S1 and S4: the user’s Navidrome', () => {
  let mock: MockSubsonic;
  beforeAll(async () => {
    mock = await startMockSubsonic();
  });
  afterAll(() => mock.close());
  const client = async () =>
    createClient(
      { url: new URL(mock.url), address: '127.0.0.1' },
      { username: mock.username, password: mock.password },
    );

  it('structured enhanced lyrics: word-timed with cues, line-timed without, none otherwise', async () => {
    const s = navidromeSource(client);
    const word = await s.fetch({ ...input, navidromeId: 'al-1-t1' }, signal);
    expect(word).toMatchObject({
      kind: 'found',
      candidate: {
        sync: 'word',
        source: 'navidrome',
        attribution: { text: 'Lyrics from your library' },
      },
    });
    if (word.kind === 'found')
      expect(word.candidate.lines[0]?.words?.map((w) => w.text)).toEqual(['First', 'line', 'here']);
    expect(await s.fetch({ ...input, navidromeId: 'al-1-t2' }, signal)).toMatchObject({
      kind: 'found',
      candidate: { sync: 'line' },
    });
    expect(await s.fetch({ ...input, navidromeId: 'al-2-t1' }, signal)).toEqual({
      kind: 'notFound',
    });
    expect((mock.requests.find((q) => q.has('enhanced')) as URLSearchParams).get('enhanced')).toBe(
      'true',
    );
  });

  it('legacy plain text by artist and title', async () => {
    const s = navidromePlainSource(client);
    const o = await s.fetch({ ...input, title: 'Copper Rain 1', navidromeId: 'al-2-t1' }, signal);
    expect(o).toMatchObject({
      kind: 'found',
      candidate: {
        sync: 'none',
        source: 'navidrome-plain',
        lines: [{ text: 'Plain words' }, { text: 'from tags' }],
      },
    });
    expect(await s.fetch({ ...input, navidromeId: 'x' }, signal)).toEqual({ kind: 'notFound' });
  });
});

describe('the Spicy key (Admin → Server, write-only)', () => {
  it('only an admin sets it; it is sealed and never returned', async () => {
    const t = testDeps();
    const db = t.deps.auth.db;
    const user = (name: string, role: string) => {
      const id = Number(
        db
          .prepare(
            'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, 0)',
          )
          .run(name, 'x', role).lastInsertRowid,
      );
      return `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
    };
    const admin = user('ada', 'admin');
    const bo = user('bo', 'user');
    expect((await call(t.app, 'GET', '/api/v1/admin/settings', undefined, bo)).status).toBe(403);
    expect(
      (await call(t.app, 'PUT', '/api/v1/admin/settings', { lyrics: { spicyKey: FAKE_SK_3 } }, bo))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          t.app,
          'PUT',
          '/api/v1/admin/settings',
          { lyrics: { spicyKey: FAKE_PK_0 } },
          admin,
        )
      ).status,
    ).toBe(400);
    const put = await call(
      t.app,
      'PUT',
      '/api/v1/admin/settings',
      { lyrics: { spicyKey: FAKE_SK_2 } },
      admin,
    );
    const text = await put.text();
    expect(JSON.parse(text).lyrics).toEqual({ spicyKeySaved: true });
    expect(text).not.toContain(FAKE_SK_2);
    const stored = db
      .prepare("SELECT secret_enc FROM server_settings WHERE key = 'lyrics.spicyKey'")
      .pluck()
      .get() as string;
    expect(stored).toMatch(/^v1:/);
    const { spicyKey } = await import('../admin.ts');
    expect(spicyKey(db, t.deps.auth.sealer)).toBe(FAKE_SK_2);
    await call(t.app, 'PUT', '/api/v1/admin/settings', { lyrics: { spicyKey: null } }, admin);
    expect(spicyKey(db, t.deps.auth.sealer)).toBeNull();
    expect(
      db.prepare("SELECT event FROM audit_log WHERE event LIKE 'admin.spicy%'").pluck().all(),
    ).toEqual(['admin.spicy_key_set', 'admin.spicy_key_removed']);
  });
});
