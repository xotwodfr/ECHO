import { describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { openDb } from '../db/db.ts';
import { createApp } from '../index.ts';
import { call, testDeps } from '../testing.ts';
import type { Source } from './sources.ts';
import { createSpotifyIds, MAPPING_TTL } from './spotifyId.ts';

// LI-08 (LYRICS_INTEGRATION.md §4.3): Spotify-ID resolution only with a Spotify connection and the
// user's opt-in; by ISRC, else title + primary artist (±2 s, similarity ≥ 0.9); mappings shared and
// kept 30 days (none: 7 days).

const ID_A = 'A'.repeat(22);
const ID_B = 'B'.repeat(22);
const input = {
  trackKey: 'navidrome:t1',
  navidromeId: 't1',
  title: 'Harbour Lights',
  artist: 'Lowfield & Friends',
  durationMs: 200_000,
};

function setup(token: string | null = 'tok') {
  const clock = { t: 1_000_000 };
  const db = openDb(':memory:');
  const searches: URLSearchParams[] = [];
  let items: { id: string; name: string; duration_ms: number }[] = [];
  let tokens = 0;
  const ids = createSpotifyIds({
    db,
    now: () => clock.t,
    apiUrl: 'https://api.spotify.test',
    tokenFor: async () => {
      tokens++;
      return token;
    },
    fetch: async (url) => {
      searches.push(new URL(String(url)).searchParams);
      return Response.json({ tracks: { items } });
    },
  });
  return {
    ids,
    clock,
    searches,
    tokens: () => tokens,
    items: (x: typeof items) => {
      items = x;
    },
  };
}

describe('Spotify IDs for Navidrome tracks', () => {
  it('no connection or no opt-in (tokenFor null): no lookup, nothing cached', async () => {
    const s = setup(null);
    expect(await s.ids.idFor(1, 'nd', input)).toBeUndefined();
    expect(s.searches).toHaveLength(0);
    s.items([{ id: ID_A, name: 'Harbour Lights', duration_ms: 200_000 }]);
    expect(await s.ids.idFor(1, 'nd', input)).toBeUndefined();
    expect(s.tokens()).toBe(2); // asked again: a miss without a lookup is not remembered
  });

  it('by ISRC first', async () => {
    const s = setup();
    s.items([{ id: ID_A, name: 'Whatever', duration_ms: 1 }]);
    expect(await s.ids.idFor(1, 'nd', { ...input, isrc: 'GBAYE0601498' })).toBe(ID_A);
    expect(s.searches[0]?.get('q')).toBe('isrc:GBAYE0601498');
    expect(s.searches[0]?.get('limit')).toBe('1');
  });

  it('else title + primary artist, accepting only duration ±2 s and similarity ≥ 0.9', async () => {
    const s = setup();
    s.items([
      { id: ID_B, name: 'Harbour Lights', duration_ms: 205_000 }, // 5 s off
      { id: ID_A, name: 'Harbour Lights (Remastered)', duration_ms: 201_500 },
    ]);
    expect(await s.ids.idFor(1, 'nd', input)).toBe(ID_A);
    expect(s.searches[0]?.get('q')).toBe('track:"Harbour Lights" artist:"Lowfield"');
    expect(s.searches[0]?.get('limit')).toBe('5');
    const t = setup();
    t.items([{ id: ID_B, name: 'Harbor Nights Forever', duration_ms: 200_000 }]);
    expect(await t.ids.idFor(1, 'nd', input)).toBeUndefined();
  });

  it('mappings are shared, 30 days for a match and 7 for none', async () => {
    const s = setup();
    s.items([{ id: ID_A, name: 'Harbour Lights', duration_ms: 200_000 }]);
    await s.ids.idFor(1, 'nd', input);
    // Another user (who could not look up) gets the shared mapping.
    expect(await s.ids.idFor(2, 'nd', input)).toBe(ID_A);
    expect(s.searches).toHaveLength(1);
    // Another Navidrome server's t1 is another track.
    s.items([]);
    expect(await s.ids.idFor(1, 'other', input)).toBeUndefined();
    s.clock.t += MAPPING_TTL.none + 1; // the "none" on 'other' has expired, the match has not
    await s.ids.idFor(1, 'other', input);
    expect(s.searches).toHaveLength(3);
    expect(await s.ids.idFor(2, 'nd', input)).toBe(ID_A);
    s.clock.t += MAPPING_TTL.found;
    await s.ids.idFor(2, 'nd', input);
    expect(s.searches).toHaveLength(4);
  });
});

describe('the shared mappings cannot be poisoned (security review)', () => {
  it('made-up metadata for another user’s track id lands in its own entry', async () => {
    const s = setup();
    // An attacker asks with the real track id but metadata of some other song.
    s.items([{ id: ID_B, name: 'Decoy Song', duration_ms: 100_000 }]);
    await s.ids.idFor(1, 'nd', { ...input, title: 'Decoy Song', durationMs: 100_000 });
    await s.ids.idFor(1, 'nd', { ...input, isrc: 'XXAAA0000001' });
    // The honest request is not served the decoy: it looks up its own basis.
    s.items([{ id: ID_A, name: 'Harbour Lights', duration_ms: 200_000 }]);
    expect(await s.ids.idFor(2, 'nd', input)).toBe(ID_A);
    expect(s.searches).toHaveLength(3);
  });
});

describe('the route: opt-in setting and Spicy for Navidrome tracks', () => {
  it('GET/PUT /me/settings: default off, only known keys', async () => {
    const t = testDeps();
    const db = t.deps.auth.db;
    const id = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'user', 0)",
        )
        .run().lastInsertRowid,
    );
    const cookie = `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
    const app = createApp(t.deps);
    expect(
      await (await call(app, 'GET', '/api/v1/me/settings', undefined, cookie)).json(),
    ).toMatchObject({ version: 2, lyrics: { useSpotifyForLookup: false } });
    // Every §7.1 key is checked; the per-device ones never reach the server.
    for (const bad of [
      { lyrics: { globalOffsetMs: 25 } },
      { lyrics: { sizeScale: 2 } },
      { visuals: { intensity: 'loud' } },
      { visuals: { quality: 'high' } },
      { playback: { quality: 'raw' } },
      { playback: { crossfadeSec: 9 } },
    ])
      expect((await call(app, 'PUT', '/api/v1/me/settings', bad, cookie)).status).toBe(400);
    const vis = await call(
      app,
      'PUT',
      '/api/v1/me/settings',
      { visuals: { intensity: 'subtle' }, lyrics: { globalOffsetMs: -150 } },
      cookie,
    );
    expect(await vis.json()).toMatchObject({
      visuals: { intensity: 'subtle', mode: 'auto' },
      lyrics: { globalOffsetMs: -150 },
    });
    for (const bad of [
      { other: 1 },
      { lyrics: { useSpotifyForLookup: 'yes' } },
      { lyrics: { x: true } },
    ])
      expect((await call(app, 'PUT', '/api/v1/me/settings', bad, cookie)).status).toBe(400);
    const ok = await call(
      app,
      'PUT',
      '/api/v1/me/settings',
      { lyrics: { useSpotifyForLookup: true } },
      cookie,
    );
    expect((await ok.json()).lyrics.useSpotifyForLookup).toBe(true);
    const { userSettings } = await import('../settings.ts');
    expect(userSettings(db, id).lyrics.useSpotifyForLookup).toBe(true);
  });

  it('a Navidrome track with a resolved id reaches Spicy with it', async () => {
    const t = testDeps();
    const db = t.deps.auth.db;
    const id = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'user', 0)",
        )
        .run().lastInsertRowid,
    );
    const seen: (string | undefined)[] = [];
    const spicy: Source = {
      id: 'spicy',
      timeoutMs: 1000,
      retryAfterMs: null,
      metadataKeyed: false,
      eligible: (i) => !!i.spotifyId,
      fetch: async (i) => {
        seen.push(i.spotifyId);
        return { kind: 'notFound' };
      },
    };
    t.deps.lyrics.sourcesFor = () => [spicy];
    t.deps.lyrics.spotifyIdFor = async (_u, scope, i) =>
      scope === 'none' && i.navidromeId === 'al-1-t1' && i.isrc === 'GBAYE0601498'
        ? ID_A
        : undefined;
    const app = createApp(t.deps);
    const cookie = `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
    await call(
      app,
      'GET',
      '/api/v1/lyrics?trackKey=navidrome:al-1-t1&title=T&artist=A&durationMs=200000&isrc=gbaye0601498',
      undefined,
      cookie,
    );
    expect(seen).toEqual([ID_A]);
  });
});

describe('the lyrics cache key includes the ISRC (security review)', () => {
  it('a request with another ISRC does not share (or fill) the entry', async () => {
    const t = testDeps();
    const db = t.deps.auth.db;
    const uid = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'user', 0)",
        )
        .run().lastInsertRowid,
    );
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
            attribution: { text: i.spotifyId as string },
            lines: [{ text: i.spotifyId as string, start: 1000 }],
          },
        };
      },
    };
    t.deps.lyrics.sourcesFor = () => [spicy];
    t.deps.lyrics.spotifyIdFor = async (_u, _s, i) => (i.isrc === 'GBAYE0601498' ? ID_A : ID_B);
    const app = createApp(t.deps);
    const cookie = `__Host-echo_session=${createSession(db, uid, 'web', t.clock.t)}`;
    const get = async (isrc: string) => {
      const r = await call(
        app,
        'GET',
        `/api/v1/lyrics?trackKey=navidrome:t1&title=T&artist=A&durationMs=200000&isrc=${isrc}`,
        undefined,
        cookie,
      );
      return r.json();
    };
    expect((await get('XXAAA0000001')).doc.lines[0].text).toBe(ID_B); // the forged one
    expect((await get('GBAYE0601498')).doc.lines[0].text).toBe(ID_A); // not served ID_B's
    expect(seen).toEqual([ID_B, ID_A]);
  });
});
