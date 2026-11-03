import { describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { createApp } from '../index.ts';
import { call, testDeps } from '../testing.ts';
import type { Candidate, Outcome, Source, SourceId } from './sources.ts';

// GET /api/v1/lyrics and the per-track override: cache, negatives, pins, scope, session.

const candidate = (source: Candidate['source']): Candidate => ({
  source,
  sync: 'line',
  offsetMs: 0,
  attribution: { text: `from ${source}` },
  lines: [{ text: 'hello', start: 1000 }],
});

function src(id: SourceId, outcome: () => Outcome) {
  const calls = { n: 0 };
  const s: Source = {
    id,
    timeoutMs: 1000,
    retryAfterMs: null,
    metadataKeyed: false,
    eligible: () => true,
    fetch: async () => {
      calls.n++;
      return outcome();
    },
  };
  return { s, calls };
}

function setup(sources: Source[], scope = 'http://nd') {
  const t = testDeps();
  t.deps.lyrics.sourcesFor = () => sources;
  t.deps.lyrics.scopeFor = () => scope;
  const app = createApp(t.deps);
  const db = t.deps.auth.db;
  const id = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'user', 0)",
      )
      .run().lastInsertRowid,
  );
  const cookie = `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
  const get = (q: string) => call(app, 'GET', `/api/v1/lyrics?${q}`, undefined, cookie);
  return { ...t, app, cookie, get };
}

const Q = 'trackKey=navidrome:t1&title=Song&artist=Band&durationMs=200000';

describe('GET /api/v1/lyrics', () => {
  it('resolves once, then serves the cache; the override comes along', async () => {
    const nd = src('navidrome', () => ({ kind: 'found', candidate: candidate('navidrome') }));
    const s = setup([nd.s]);
    const a = await s.get(Q);
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({
      doc: { source: 'navidrome', trackKey: 'navidrome:t1' },
      override: { offsetMs: 0, pinnedSource: null },
    });
    expect(a.headers.get('cache-control')).toBe('private, no-store');
    await s.get(Q);
    expect(nd.calls.n).toBe(1);
  });

  // ON-DB-2: a cache write that fails (a full disk) must not turn found lyrics into a 500, and the
  // detached late write must not reject unhandled (Node exits on that).
  it('a failing cache write still delivers the lyrics, and is logged', async () => {
    const nd = src('navidrome', () => ({ kind: 'found', candidate: candidate('navidrome') }));
    const s = setup([nd.s]);
    const logged: string[] = [];
    s.deps.lyrics.log = (_level, msg) => void logged.push(msg);
    s.deps.lyrics.cache.put = async () => {
      throw new Error('ENOSPC: no space left on device');
    };
    const r = await s.get(Q);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ doc: { source: 'navidrome' } });
    expect(logged).toEqual(['lyrics cache write failed']);
  });

  it('a source turned off in Settings never answers from the shared cache', async () => {
    const ne = src('netease', () => ({ kind: 'found', candidate: candidate('netease') }));
    const lr = src('lrclib', () => ({ kind: 'found', candidate: candidate('lrclib') }));
    let sources = [ne.s, lr.s];
    const s = setup([]);
    s.deps.lyrics.sourcesFor = () => sources;
    expect(await (await s.get(Q)).json()).toMatchObject({ doc: { source: 'netease' } });
    sources = [lr.s];
    expect(await (await s.get(Q)).json()).toMatchObject({ doc: { source: 'lrclib' } });
  });

  it('every source saying "not found" is cached as a miss; an error is not', async () => {
    const missing = src('lrclib', () => ({ kind: 'notFound' }));
    const s = setup([missing.s]);
    const r = await s.get(Q);
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ tried: [{ source: 'lrclib', outcome: 'notFound' }] });
    await s.get(Q);
    expect(missing.calls.n).toBe(1);
    const broken = src('lrclib', () => ({ kind: 'error', retriable: false, detail: '403' }));
    const e = setup([broken.s]);
    await e.get(Q);
    await e.get(Q);
    expect(broken.calls.n).toBe(2);
  });

  it('a pin resolves (and caches) apart from the shared best', async () => {
    const nd = src('navidrome', () => ({
      kind: 'found',
      candidate: {
        ...candidate('navidrome'),
        sync: 'word',
        lines: [
          {
            text: 'w',
            start: 1000,
            words: [{ text: 'w', start: 1000, end: 1500, isPartOfWord: false }],
          },
        ],
      },
    }));
    const lr = src('lrclib', () => ({ kind: 'found', candidate: candidate('lrclib') }));
    const s = setup([nd.s, lr.s]);
    expect(((await (await s.get(Q)).json()) as { doc: { source: string } }).doc.source).toBe(
      'navidrome',
    );
    const put = await call(
      s.app,
      'PUT',
      '/api/v1/me/tracks/navidrome:t1/override',
      { pinnedSource: 'lrclib', offsetMs: 150 },
      s.cookie,
    );
    expect(await put.json()).toEqual({ offsetMs: 150, pinnedSource: 'lrclib' });
    const pinned = (await (await s.get(Q)).json()) as { doc: { source: string }; override: object };
    expect(pinned.doc.source).toBe('lrclib');
    expect(pinned.override).toEqual({ offsetMs: 150, pinnedSource: 'lrclib' });
  });

  it('the override is validated; everything needs a session; a bad key is refused', async () => {
    const s = setup([]);
    const put = (body: object) =>
      call(s.app, 'PUT', '/api/v1/me/tracks/navidrome:t1/override', body, s.cookie);
    expect((await put({ offsetMs: 10_001 })).status).toBe(400);
    expect((await put({ offsetMs: 1.5 })).status).toBe(400);
    expect((await put({ pinnedSource: 'musixmatch' })).status).toBe(400);
    expect(await (await put({ offsetMs: -50 })).json()).toEqual({
      offsetMs: -50,
      pinnedSource: null,
    });
    expect((await call(s.app, 'GET', `/api/v1/lyrics?${Q}`)).status).toBe(401);
    expect((await s.get('trackKey=../etc')).status).toBe(400);
  });

  it('a Navidrome track key is scoped to the user’s server', async () => {
    const one = src('navidrome', () => ({ kind: 'found', candidate: candidate('navidrome') }));
    const s = setup([one.s], 'http://server-a');
    await s.get(Q);
    s.deps.lyrics.scopeFor = () => 'http://server-b';
    await s.get(Q);
    expect(one.calls.n).toBe(2); // not served server A's entry
  });
});

describe('the shared cache cannot be poisoned (security review)', () => {
  it('ids come from the track key; other metadata gets its own entry', async () => {
    const seen: { navidromeId?: string; spotifyId?: string; title: string }[] = [];
    const s1: Source = {
      id: 'navidrome',
      timeoutMs: 1000,
      retryAfterMs: null,
      metadataKeyed: false,
      eligible: () => true,
      fetch: async (i) => {
        seen.push({ navidromeId: i.navidromeId, spotifyId: i.spotifyId, title: i.title });
        return {
          kind: 'found',
          candidate: { ...candidate('navidrome'), lines: [{ text: i.title, start: 1000 }] },
        };
      },
    };
    const s = setup([s1]);
    // An attacker asks for t1 with another track's id and another song's title.
    await s.get(
      'trackKey=navidrome:t1&title=Other%20Song&artist=Band&navidromeId=t9&spotifyId=4cOdK2wGLETKBW3PvgPWqT',
    );
    expect(seen[0]).toEqual({ navidromeId: 't1', spotifyId: undefined, title: 'Other Song' });
    // The honest request for t1 is not served the planted entry.
    const honest = (await (await s.get('trackKey=navidrome:t1&title=Song&artist=Band')).json()) as {
      doc: { lines: { text: string }[] };
    };
    expect(honest.doc.lines[0]?.text).toBe('Song');
    // The same metadata (in another spelling) is shared.
    await s.get('trackKey=navidrome:t1&title=SONG&artist=band');
    expect(seen).toHaveLength(2);
  });
});

describe('YouTube songs and Spicy Lyrics (Liner notes spec)', () => {
  it('matches from the catalogue, never from the request', async () => {
    const seen: { spotifyId?: string; title?: string }[] = [];
    const spy: Source = {
      ...src('spicy', () => ({ kind: 'notFound' })).s,
      fetch: async (input) => {
        seen.push({ spotifyId: input.spotifyId, title: input.title });
        return { kind: 'notFound' };
      },
    };
    const s = setup([spy]);
    const asked: unknown[][] = [];
    s.deps.lyrics.youtubeSpotifyIdsFor = async (...args: unknown[]) => {
      asked.push(args);
      return ['4uLU6hMCjMI75M1A2tKUQC'];
    };
    const app = createApp(s.deps);
    await call(
      app,
      'GET',
      '/api/v1/lyrics?trackKey=youtube:fakesong001&title=Wrong&artist=Wrong&durationMs=180000',
      undefined,
      s.cookie,
    );
    expect(asked).toEqual([['fakesong001']]);
    expect(seen[0]?.spotifyId).toBe('4uLU6hMCjMI75M1A2tKUQC');
  });
});
