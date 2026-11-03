import { Hono, type MiddlewareHandler } from 'hono';
import { type AuthEnv, jsonObject } from './auth/routes.ts';
import type { Db } from './db/db.ts';
import type { SubsonicClient } from './navidrome/client.ts';

// The Wanted list: one list for everyone on this server, of music that is not in Navidrome yet
// (it replaced Spotify for that, 2026-11-03). An item is free text. ECHO searches the library for
// each item still missing, when the list is opened (an item at most every ten minutes) and daily,
// and marks it found when an album, else a song, has every word of it in its artist and title.
// ponytail: one found state for the server; with several Navidrome servers the last check wins.

const MAX_TEXT = 200;
export const RECHECK_MS = 10 * 60_000;
const FALLBACK_WORDS = 3;

export interface Found {
  kind: 'album' | 'song';
  id: string;
  title: string;
  artist: string;
  /** A song's album, to play it in its album. */
  albumId?: string;
}

/** Lower-case words, accents and punctuation dropped: what an item and a library entry compare by. */
export const wordsOf = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

type Album = { id: string; name: string; artist?: string };
type Song = { id: string; title: string; artist?: string; albumId?: string };

const hasAll = (words: string[], ...fields: (string | undefined)[]) => {
  const have = new Set(wordsOf(fields.filter(Boolean).join(' ')));
  return words.every((w) => have.has(w));
};

/** The first album, else song, with every word in its artist and title. */
export function bestMatch(words: string[], r: { album?: Album[]; song?: Song[] }): Found | null {
  if (!words.length) return null;
  const a = (r.album ?? []).find((x) => hasAll(words, x.artist, x.name));
  if (a) return { kind: 'album', id: String(a.id), title: a.name, artist: a.artist ?? '' };
  const s = (r.song ?? []).find((x) => hasAll(words, x.artist, x.title));
  if (!s) return null;
  return {
    kind: 'song',
    id: String(s.id),
    title: s.title,
    artist: s.artist ?? '',
    ...(s.albumId && { albumId: String(s.albumId) }),
  };
}

/**
 * The library's match for `words`. Servers differ in how search3 reads several words (some look
 * for the whole text in a name), so a miss asks again by the longest words, one at a time.
 */
async function search(client: SubsonicClient, words: string[]): Promise<Found | null> {
  const ask = async (query: string) => {
    const r = await client.call('search3', {
      query,
      songCount: '20',
      albumCount: '20',
      artistCount: '0',
    });
    return bestMatch(words, (r.searchResult3 ?? {}) as { album?: Album[]; song?: Song[] });
  };
  const whole = await ask(words.join(' '));
  if (whole || words.length < 2) return whole;
  for (const w of [...words].sort((a, b) => b.length - a.length).slice(0, FALLBACK_WORDS)) {
    const found = await ask(w);
    if (found) return found;
  }
  return null;
}

/**
 * Searches the library for what is still missing and not checked within `olderThanMs` (`only`: that
 * item alone).
 */
export async function checkWanted(
  db: Db,
  client: SubsonicClient,
  now: number,
  olderThanMs = 0,
  only?: number,
) {
  const rows = db
    .prepare(
      `SELECT id, norm FROM wanted WHERE found_json IS NULL AND checked_at <= ?
       ${only === undefined ? '' : 'AND id = ?'}`,
    )
    .all(now - olderThanMs, ...(only === undefined ? [] : [only])) as {
    id: number;
    norm: string;
  }[];
  const mark = db.prepare('UPDATE wanted SET found_json = ?, checked_at = ? WHERE id = ?');
  for (const r of rows) {
    let found: Found | null;
    try {
      found = await search(client, r.norm.split(' '));
    } catch {
      return; // Navidrome is not answering: the next look asks again
    }
    mark.run(found ? JSON.stringify(found) : null, now, r.id);
  }
}

export function wantedRoutes(
  deps: {
    db: Db;
    now: () => number;
    navidrome: (userId: number) => Promise<SubsonicClient | null>;
  },
  requireUser: MiddlewareHandler<AuthEnv>,
) {
  const { db, now } = deps;
  const app = new Hono<AuthEnv>();
  const client = (userId: number) => deps.navidrome(userId).catch(() => null);
  const items = (id?: number) =>
    (
      db
        .prepare(
          `SELECT w.id, w.text, w.added_at AS addedAt, w.found_json AS found, u.username AS addedBy
           FROM wanted w LEFT JOIN users u ON u.id = w.added_by
           ${id === undefined ? '' : 'WHERE w.id = ?'}
           ORDER BY w.added_at DESC, w.id DESC`,
        )
        .all(...(id === undefined ? [] : [id])) as {
        id: number;
        text: string;
        addedAt: number;
        found: string | null;
        addedBy: string | null;
      }[]
    ).map((r) => ({ ...r, found: r.found ? (JSON.parse(r.found) as Found) : null }));

  app.get('/wanted', requireUser, async (c) => {
    const nd = await client(c.var.user.id);
    if (nd) await checkWanted(db, nd, now(), RECHECK_MS);
    return c.json(items());
  });

  app.post('/wanted', requireUser, async (c) => {
    const b = await jsonObject(c);
    const text = typeof b?.text === 'string' ? b.text.trim().replace(/\s+/g, ' ') : '';
    const words = wordsOf(text);
    if (!words.length || text.length > MAX_TEXT)
      return c.json(
        { error: 'bad_wanted', detail: `1 to ${MAX_TEXT} characters, with words` },
        400,
      );
    const norm = words.join(' ');
    // The same words are the same item, whoever adds them.
    const known = db.prepare('SELECT id FROM wanted WHERE norm = ?').pluck().get(norm) as
      | number
      | undefined;
    if (known !== undefined) return c.json(items(known)[0]);
    const id = Number(
      db
        .prepare('INSERT INTO wanted (text, norm, added_by, added_at) VALUES (?, ?, ?, ?)')
        .run(text, norm, c.var.user.id, now()).lastInsertRowid,
    );
    const nd = await client(c.var.user.id);
    if (nd) await checkWanted(db, nd, now(), 0, id);
    return c.json(items(id)[0], 201);
  });

  // One shared list: anyone removes anything.
  app.delete('/wanted/:id', requireUser, (c) => {
    const removed = db.prepare('DELETE FROM wanted WHERE id = ?').run(Number(c.req.param('id')));
    return removed.changes ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  return app;
}
