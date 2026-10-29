import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { createApp } from './index.ts';
import { type MockSubsonic, startMockSubsonic } from './navidrome/mock.ts';
import {
  dailyMixes,
  daylist,
  discover,
  onRepeat,
  type Play,
  partOfDay,
  playOf,
  rewind,
  wrapped,
} from './plays.ts';
import { call, testDeps } from './testing.ts';

// Project 2 of the Spotify redesign: plays recorded per user, and the mixes, Jump back in and
// Wrapped made from them.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 29, 9, 0); // a Thursday morning, UTC

const play = (id: string, artist: string, daysAgo: number, extra: Partial<Play> = {}): Play => ({
  id,
  title: `Song ${id}`,
  artist,
  artistId: `id-${artist}`,
  album: `Album of ${artist}`,
  albumId: `al-${artist}`,
  durationMs: 180_000,
  playedAt: NOW - daysAgo * DAY,
  ...extra,
});
const times = (n: number, f: (i: number) => Play) => Array.from({ length: n }, (_, i) => f(i));

describe('mixes from plays', () => {
  it('On Repeat: songs played twice or more lately, most played first', () => {
    const plays = [
      ...times(5, (i) => play('a', 'Lowfield', i)),
      ...times(3, (i) => play('b', 'Lowfield', i)),
      ...times(2, (i) => play('c', 'Mira', i)),
      ...times(2, (i) => play('d', 'Mira', i)),
      ...times(2, (i) => play('e', 'Mira', i)),
      play('once', 'Mira', 1),
      ...times(9, () => play('old', 'Mira', 40)),
    ];
    const mix = onRepeat(plays, NOW);
    expect(mix?.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(onRepeat(plays.slice(0, 8), NOW)).toBeNull(); // too few for a mix
  });

  it('Repeat Rewind: old favourites not played in the last month', () => {
    const plays = [
      ...times(6, (i) => play(`old-${i}`, 'Lowfield', 60 + i)),
      play('old-0', 'Lowfield', 3), // played lately again: not a rewind
    ];
    expect(rewind(plays, NOW)?.tracks.map((t) => t.id)).toEqual([
      'old-1',
      'old-2',
      'old-3',
      'old-4',
      'old-5',
    ]);
  });

  it('daylist: what is played at this part of the day, named for it', () => {
    expect([partOfDay(5), partOfDay(12), partOfDay(17), partOfDay(22), partOfDay(3)]).toEqual([
      'morning',
      'afternoon',
      'evening',
      'night',
      'night',
    ]);
    const mornings = times(6, (i) => play(`m${i}`, 'Lowfield', i + 1));
    const nights = times(6, (i) =>
      play(`n${i}`, 'Mira', i + 1, { playedAt: NOW - (i + 1) * DAY + 14 * 3_600_000 }),
    );
    const mix = daylist([...mornings, ...nights], NOW);
    expect(mix?.title).toBe('daylist: thursday morning');
    expect(mix?.tracks.map((t) => t.id).sort()).toEqual(mornings.map((p) => p.id).sort());
    // UTC-10: 23:00 the evening before, local.
    expect(daylist([...mornings, ...nights], NOW, 600)?.title).toBe('daylist: wednesday night');
  });

  it('Daily Mixes: one per top artist, their plays and the library’s songs interleaved', () => {
    const plays = [
      ...times(6, (i) => play(`l${i % 3}`, 'Lowfield', i)),
      ...times(4, (i) => play(`m${i % 2}`, 'Mira', i)),
      ...times(2, (i) => play('f', 'Field', i)), // two plays: no mix
    ];
    const mixes = dailyMixes(plays, NOW, (a) =>
      a.name === 'Lowfield'
        ? [play('l0', 'Lowfield', 0), play('x1', 'Similar One', 0), play('x2', 'Similar Two', 0)]
        : [],
    );
    expect(mixes.map((m) => m.title)).toEqual(['Daily Mix 1', 'Daily Mix 2']);
    expect(mixes[0]?.subtitle).toBe('Lowfield, Similar One, Similar Two and more');
    expect(mixes[0]?.tracks.map((t) => t.id).sort()).toEqual(['l0', 'l1', 'l2', 'x1', 'x2']);
    // The same order all day, a new one tomorrow.
    expect(dailyMixes(plays, NOW + 3_600_000)[0]?.tracks).toEqual(
      dailyMixes(plays, NOW)[0]?.tracks,
    );
  });

  it('Discover Weekly: only songs not played yet, the same all week', () => {
    const plays = [play('heard', 'Lowfield', 1)];
    const candidates = [
      play('heard', 'Lowfield', 0),
      ...times(8, (i) => play(`new${i}`, 'Mira', 0)),
    ];
    const mix = discover(plays, NOW, candidates);
    expect(mix?.tracks.map((t) => t.id)).not.toContain('heard');
    expect(mix?.tracks).toHaveLength(8);
    // Monday 2026-10-26 to Sunday 2026-11-01 share an order.
    const monday = Date.UTC(2026, 9, 26, 0, 1);
    const sunday = Date.UTC(2026, 10, 1, 23, 59);
    expect(discover(plays, monday, candidates)?.tracks).toEqual(
      discover(plays, sunday, candidates)?.tracks,
    );
    expect(discover(plays, NOW, candidates.slice(0, 4))).toBeNull();
  });

  it('Wrapped: minutes, the top artists, songs and albums, and the biggest day', () => {
    const plays = [
      ...times(3, (i) => play('a', 'Lowfield', i)),
      ...times(2, () => play('b', 'Mira', 5)),
      play('last-year', 'Field', 400),
    ];
    const w = wrapped(plays, 2026);
    expect(w.plays).toBe(5);
    expect(w.minutes).toBe(15);
    expect(w.artists.map((a) => [a.name, a.plays])).toEqual([
      ['Lowfield', 3],
      ['Mira', 2],
    ]);
    expect(w.tracks[0]).toMatchObject({ id: 'a', plays: 3 });
    expect(w.albums[0]).toMatchObject({ title: 'Album of Lowfield', plays: 3 });
    expect(w.topDay).toEqual({ date: '2026-10-24', plays: 2 });
    expect(wrapped(plays, 2020)).toMatchObject({ plays: 0, topDay: null, artists: [] });
  });
});

describe('a play from the client', () => {
  const track = {
    provider: 'navidrome',
    id: 'so-1',
    title: 'Harbour Lights 1',
    artists: [{ id: 'ar-1', name: 'Lowfield' }],
    album: { id: 'al-1', title: 'Harbour Lights' },
    durationMs: 200_000,
    artwork: [{ url: '/api/v1/navidrome/cover/al-1?size=600' }],
  };

  it('is a Navidrome song with a title and an artist', () => {
    expect(
      playOf({ track, context: { kind: 'album', id: 'al-1', title: 'Harbour Lights' } }, NOW),
    ).toEqual({
      id: 'so-1',
      title: 'Harbour Lights 1',
      artist: 'Lowfield',
      artistId: 'ar-1',
      album: 'Harbour Lights',
      albumId: 'al-1',
      durationMs: 200_000,
      cover: '/api/v1/navidrome/cover/al-1?size=600',
      playedAt: NOW,
      contextKind: 'album',
      contextId: 'al-1',
      contextTitle: 'Harbour Lights',
    });
    expect(playOf({ track: { ...track, provider: 'spotify' } }, NOW)).toBeNull();
    expect(playOf({ track: { ...track, title: '' } }, NOW)).toBeNull();
    expect(playOf({ track: { ...track, artists: [] } }, NOW)).toBeNull();
    expect(playOf({}, NOW)).toBeNull();
  });

  it('keeps only covers from ECHO’s own proxy', () => {
    const elsewhere = { ...track, artwork: [{ url: 'https://example.com/x.jpg' }] };
    expect(playOf({ track: elsewhere }, NOW)?.cover).toBeUndefined();
  });
});

describe('the routes', () => {
  let mock: MockSubsonic;
  beforeAll(async () => {
    mock = await startMockSubsonic({});
  });
  afterAll(() => mock.close());

  function setup() {
    const t = testDeps();
    t.deps.navidrome.defaultUrl = mock.url;
    const app = createApp(t.deps);
    const db = t.deps.auth.db;
    const user = (name: string) => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', 'user', 0)",
          )
          .run(name).lastInsertRowid,
      );
      return `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
    };
    return { ...t, app, user };
  }
  const songTrack = (s: MockSubsonic['songs'][number]) => ({
    provider: 'navidrome',
    id: s.id,
    title: s.title,
    artists: [{ id: s.artistId, name: s.artist }],
    album: { id: s.albumId, title: s.album },
    durationMs: s.duration * 1000,
    artwork: [],
  });

  it('records plays: Recently played, Jump back in and Wrapped read them back', async () => {
    const s = setup();
    const ada = s.user('ada');
    const [a, b] = mock.songs;
    if (!a || !b) throw new Error('mock songs');
    const ctx = { kind: 'album', id: a.albumId, title: a.album };
    for (const t of [a, b, a]) {
      s.clock.t += 60_000;
      const r = await call(
        s.app,
        'POST',
        '/api/v1/me/plays',
        { track: songTrack(t), context: ctx },
        ada,
      );
      expect(r.status).toBe(200);
    }
    expect((await call(s.app, 'POST', '/api/v1/me/plays', { track: {} }, ada)).status).toBe(400);

    const recent = await (
      await call(s.app, 'GET', '/api/v1/me/plays/recent', undefined, ada)
    ).json();
    expect(recent.tracks.map((t: { id: string }) => t.id)).toEqual([a.id, b.id]);
    const contexts = await (
      await call(s.app, 'GET', '/api/v1/me/plays/contexts', undefined, ada)
    ).json();
    expect(contexts.contexts).toEqual([
      { kind: 'album', id: a.albumId, title: a.album, at: s.clock.t },
    ]);
    const w = await (await call(s.app, 'GET', '/api/v1/me/wrapped', undefined, ada)).json();
    expect(w).toMatchObject({ year: new Date(s.clock.t).getUTCFullYear(), plays: 3 });
    expect((await call(s.app, 'GET', '/api/v1/me/wrapped?year=1', undefined, ada)).status).toBe(
      400,
    );
    // Another user's history is their own.
    const bob = s.user('bob');
    const theirs = await (
      await call(s.app, 'GET', '/api/v1/me/plays/recent', undefined, bob)
    ).json();
    expect(theirs.tracks).toEqual([]);
  });

  it('forgets plays older than two years', async () => {
    const s = setup();
    const ada = s.user('ada');
    const [a, b] = mock.songs;
    if (!a || !b) throw new Error('mock songs');
    await call(s.app, 'POST', '/api/v1/me/plays', { track: songTrack(a) }, ada);
    // Two years and a moment ago (the session would not last that long on the clock).
    s.deps.auth.db.prepare('UPDATE plays SET played_at = played_at - ?').run(2 * 365 * DAY + 1);
    await call(s.app, 'POST', '/api/v1/me/plays', { track: songTrack(b) }, ada);
    const recent = await (
      await call(s.app, 'GET', '/api/v1/me/plays/recent', undefined, ada)
    ).json();
    expect(recent.tracks.map((t: { id: string }) => t.id)).toEqual([b.id]);
  });

  it('makes Daily Mixes and Discover Weekly with the user’s Navidrome', async () => {
    const s = setup();
    const ada = s.user('ada');
    const put = await call(
      s.app,
      'PUT',
      '/api/v1/me/connections/navidrome',
      { username: 'ada', password: 'navidrome-pass' },
      ada,
    );
    expect(put.status).toBe(200);
    const lowfield = mock.songs.filter((x) => x.artist === 'Lowfield').slice(0, 2);
    for (let i = 0; i < 6; i++) {
      s.clock.t += 3 * 60_000;
      const t = lowfield[i % 2];
      if (t) await call(s.app, 'POST', '/api/v1/me/plays', { track: songTrack(t) }, ada);
    }
    const { mixes } = await (await call(s.app, 'GET', '/api/v1/me/mixes', undefined, ada)).json();
    const daily = mixes.find((m: { id: string }) => m.id === 'daily-1');
    // Lowfield's two songs played, more of theirs and their similar artists' from the library.
    expect(daily.subtitle).toMatch(/^Lowfield, /);
    expect(daily.tracks.length).toBeGreaterThan(2);
    expect(daily.tracks.some((t: { artist: string }) => t.artist !== 'Lowfield')).toBe(true);
    expect(
      daily.tracks.some((t: { cover?: string }) => t.cover?.startsWith('/api/v1/navidrome/cover/')),
    ).toBe(true);
    const disc = mixes.find((m: { id: string }) => m.id === 'discover');
    const played = new Set(lowfield.map((x) => x.id));
    expect(disc.tracks.every((t: { id: string; artist: string }) => !played.has(t.id))).toBe(true);
  });
});
