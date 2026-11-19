import { createHash } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthEnv } from './auth/routes.ts';
import type { Db } from './db/db.ts';
import type { Log } from './log.ts';
import type { SubsonicClient } from './navidrome/client.ts';

// Karaoke mode (docs/KARAOKE.md): every Navidrome song split once into instrumental and vocals by
// the stem service (stems/), so the app can turn the singer down. ECHO keeps the queue: a song
// someone asks for first, then the next songs of their queue, then the whole library, one song at
// a time. The results live on the stem service's disk; ECHO only proxies them to signed-in users.

export const PRIORITY = { library: 0, soon: 5, now: 10 } as const;
const MAX_ATTEMPTS = 3;
const RETRY_MS = 10 * 60_000;
const OFFLINE_MS = 60_000; // the stem service is down (restarting, not deployed yet): wait and ask again
const PAGE = 500;
const RETRY_FAILED_MS = 7 * 86_400_000; // a failed song is tried again a week later

export interface KaraokeDeps {
  db: Db;
  now: () => number;
  log?: Log;
  /** The stem service, e.g. http://echo-stems:8090. */
  stemsUrl: string;
  /** Longer songs are skipped (memory: the service holds a whole song while it works). */
  maxSeconds: number;
  /** Whether the library sweep queues every song, not only those asked for. */
  library: boolean;
  scopeFor: (userId: number) => string;
  navidrome: (userId: number) => Promise<SubsonicClient | null>;
  /** Each Navidrome server once, through one of its users (the sweep). */
  libraries: () => Promise<{ scope: string; userId: number; client: SubsonicClient }[]>;
}

export type JobStatus = 'queued' | 'working' | 'ready' | 'failed' | 'skipped';

interface Job {
  key: string;
  scope: string;
  track_id: string;
  user_id: number;
  status: JobStatus;
  priority: number;
  attempts: number;
}

/** The stem service's name for a song: one per Navidrome server and song id, nothing readable. */
export const stemKey = (scope: string, trackId: string) =>
  createHash('sha256').update(`${scope}|${trackId}`).digest('hex').slice(0, 40);

function send(
  url: string,
  method: string,
  headers: Record<string, string> = {},
  body?: Readable,
): Promise<IncomingMessage> {
  const mod = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    // No timeout: a PUT answers only once the song is separated, minutes later.
    const req = mod.request(url, { method, headers }, resolve);
    req.on('error', reject);
    if (body) {
      body.on('error', (err) => req.destroy(err));
      body.pipe(req);
    } else req.end();
  });
}

async function readJson(res: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of res) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

class Offline extends Error {}

export function createKaraoke(deps: KaraokeDeps) {
  const { db, now } = deps;
  const log: Log = deps.log ?? (() => {});
  const base = deps.stemsUrl.replace(/\/+$/, '');
  let busy = false;
  let pausedUntil = 0;
  let stopped = false;
  let working: string | null = null;

  // A job left "working" by a restart is simply queued again.
  db.prepare("UPDATE stems_jobs SET status = 'queued' WHERE status = 'working'").run();
  retryFailed(0);

  /**
   * Failed songs older than [age] ms get three more tries: the stem service may have been fixed
   * or given more memory since (a song it died on reads "socket hang up").
   */
  function retryFailed(age: number) {
    return db
      .prepare(
        `UPDATE stems_jobs SET status = 'queued', attempts = 0, error = NULL, next_at = 0
         WHERE status = 'failed' AND updated_at <= ?`,
      )
      .run(now() - age).changes;
  }

  const get = (key: string) =>
    db.prepare('SELECT * FROM stems_jobs WHERE key = ?').get(key) as Job | undefined;

  /** Queues the song (or raises its priority); returns the job. */
  function enqueue(userId: number, trackId: string, priority: number) {
    const scope = deps.scopeFor(userId);
    const key = stemKey(scope, trackId);
    const t = now();
    db.prepare(
      `INSERT INTO stems_jobs (key, scope, track_id, user_id, status, priority, attempts, next_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, 0, 0, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         priority = MAX(priority, excluded.priority),
         user_id = CASE WHEN excluded.priority > priority THEN excluded.user_id ELSE user_id END,
         updated_at = excluded.updated_at`,
    ).run(key, scope, trackId, userId, priority, t, t);
    kick();
    return get(key) as Job;
  }

  /** Songs ahead of this one in the queue. */
  const ahead = (job: Job) =>
    db
      .prepare(
        `SELECT COUNT(*) FROM stems_jobs WHERE status IN ('queued', 'working') AND key != ? AND
           (status = 'working' OR priority > ? OR (priority = ? AND created_at < (
             SELECT created_at FROM stems_jobs WHERE key = ?)))`,
      )
      .pluck()
      .get(job.key, job.priority, job.priority, job.key) as number;

  const next = () =>
    db
      .prepare(
        `SELECT * FROM stems_jobs WHERE status = 'queued' AND next_at <= ?
         ORDER BY priority DESC, created_at, key LIMIT 1`,
      )
      .get(now()) as Job | undefined;

  const mark = (
    key: string,
    status: JobStatus,
    extra: { error?: string; attempts?: number } = {},
  ) =>
    db
      .prepare(
        `UPDATE stems_jobs SET status = ?, error = ?, attempts = COALESCE(?, attempts),
           next_at = ?, updated_at = ? WHERE key = ?`,
      )
      .run(
        status,
        extra.error ?? null,
        extra.attempts ?? null,
        status === 'queued' && extra.attempts ? now() + RETRY_MS * extra.attempts : 0,
        now(),
        key,
      );

  async function run(job: Job) {
    const client = await deps.navidrome(job.user_id).catch(() => null);
    if (!client) throw new Error('navidrome_unavailable');
    const song = await client
      .call('getSong', { id: job.track_id })
      .then((r) => r.song as { duration?: number } | undefined)
      .catch(() => undefined);
    if ((song?.duration ?? 0) > deps.maxSeconds) return 'skipped' as const;
    const src = await client.request('stream', { id: job.track_id, format: 'raw' });
    const type = String(src.headers['content-type'] ?? '');
    if ((src.statusCode ?? 500) >= 400 || type.includes('json')) {
      src.resume();
      throw new Error(`stream ${src.statusCode}`);
    }
    const length = src.headers['content-length'];
    let res: IncomingMessage;
    try {
      res = await send(
        `${base}/separate/${job.key}`,
        'PUT',
        length ? { 'content-length': String(length) } : { 'transfer-encoding': 'chunked' },
        src,
      );
    } catch (err) {
      src.destroy();
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH'].includes(code))
        throw new Offline(code);
      throw err;
    }
    const body = await readJson(res);
    if (res.statusCode !== 200) throw new Error(String(body.error ?? `HTTP ${res.statusCode}`));
    log('info', 'karaoke: song separated', { bytes: body.bytes, seconds: body.seconds });
    return 'ready' as const;
  }

  async function loop() {
    if (busy || stopped) return;
    busy = true;
    try {
      while (!stopped && now() >= pausedUntil) {
        const job = next();
        if (!job) break;
        working = job.key;
        mark(job.key, 'working');
        try {
          mark(job.key, await run(job));
        } catch (err) {
          if (err instanceof Offline) {
            mark(job.key, 'queued');
            pausedUntil = now() + OFFLINE_MS;
            log('warn', 'karaoke: the stem service is not reachable', { detail: err.message });
            break;
          }
          const attempts = job.attempts + 1;
          const error = String((err as Error).message ?? err).slice(0, 200);
          mark(job.key, attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', { attempts, error });
          log('warn', 'karaoke: separation failed', { attempts, error });
        } finally {
          working = null;
        }
      }
    } finally {
      busy = false;
    }
  }
  function kick() {
    void loop();
  }

  /** Every song of every library, queued at the lowest priority (songs already known are kept). */
  async function sweep() {
    const retried = retryFailed(RETRY_FAILED_MS);
    if (retried) log('info', 'karaoke: failed songs tried again', { songs: retried });
    if (!deps.library) {
      kick();
      return 0;
    }
    let added = 0;
    for (const lib of await deps.libraries().catch(() => [])) {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO stems_jobs (key, scope, track_id, user_id, status, priority,
           attempts, next_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', 0, 0, 0, ?, ?)`,
      );
      const seen = new Set<string>();
      for (let offset = 0; ; offset += PAGE) {
        const r = await lib.client
          .call('search3', {
            query: '',
            songCount: String(PAGE),
            songOffset: String(offset),
            artistCount: '0',
            albumCount: '0',
          })
          .catch(() => null);
        const songs = ((r?.searchResult3 as { song?: { id: string }[] })?.song ?? []).filter(
          (s) => !seen.has(s.id),
        );
        const t = now();
        db.transaction(() => {
          for (const s of songs) {
            seen.add(s.id);
            added += insert.run(
              stemKey(lib.scope, s.id),
              lib.scope,
              s.id,
              lib.userId,
              t,
              t,
            ).changes;
          }
        })();
        if (songs.length < PAGE) break;
      }
    }
    if (added) log('info', 'karaoke: library queued', { songs: added });
    kick();
    return added;
  }

  function counts() {
    const rows = db
      .prepare('SELECT status, COUNT(*) AS n FROM stems_jobs GROUP BY status')
      .all() as { status: JobStatus; n: number }[];
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
      Record<JobStatus, number>
    >;
    return {
      ready: by.ready ?? 0,
      queued: (by.queued ?? 0) + (by.working ?? 0),
      failed: by.failed ?? 0,
      skipped: by.skipped ?? 0,
    };
  }

  /** The stem service's own count of what is on its disk, or null when it does not answer. */
  async function disk() {
    try {
      const res = await send(`${base}/stats`, 'GET');
      return res.statusCode === 200
        ? ((await readJson(res)) as { songs: number; bytes: number })
        : null;
    } catch {
      return null;
    }
  }

  /**
   * The songs ready on the user's own Navidrome server, newest first, as Subsonic songs (the
   * user's Navidrome is asked for each; songs it no longer has are left out).
   */
  async function readySongs(userId: number, limit: number) {
    const scope = deps.scopeFor(userId);
    const ids = db
      .prepare(
        `SELECT track_id FROM stems_jobs WHERE scope = ? AND status = 'ready'
         ORDER BY updated_at DESC, key LIMIT ?`,
      )
      .pluck()
      .all(scope, limit) as string[];
    const client = ids.length ? await deps.navidrome(userId).catch(() => null) : null;
    if (!client) return [];
    const songs = await Promise.all(
      ids.map((id) =>
        client
          .call('getSong', { id })
          .then((r) => r.song as Record<string, unknown> | undefined)
          .catch(() => undefined),
      ),
    );
    return songs.filter((s): s is Record<string, unknown> => !!s);
  }

  return {
    enqueue,
    readySongs,
    ahead,
    get,
    sweep,
    counts,
    disk,
    kick,
    mark,
    working: () => working,
    base,
    stop() {
      stopped = true;
    },
  };
}

export type Karaoke = ReturnType<typeof createKaraoke>;

const TRACK_ID = /^[\w.:-]{1,200}$/;

export function karaokeRoutes(k: Karaoke | null, requireUser: MiddlewareHandler<AuthEnv>) {
  const app = new Hono<AuthEnv>();

  app.get('/karaoke', requireUser, async (c) => {
    if (!k) return c.json({ enabled: false });
    const disk = await k.disk();
    return c.json({
      enabled: true,
      online: disk !== null,
      ...k.counts(),
      bytes: disk?.bytes ?? null,
    });
  });

  /** Songs with a karaoke version ready (Home's Karaoke shelf), newest first. */
  app.get('/karaoke/ready', requireUser, async (c) => {
    if (!k) return c.json({ songs: [] });
    const limit = Math.min(60, Math.max(1, Number(c.req.query('limit')) || 30));
    return c.json({ songs: await k.readySongs(c.var.user.id, limit) });
  });

  /**
   * The song's karaoke version: ready, or queued (asked for now, or `?soon=1` for a song coming up
   * in the queue, which waits behind those asked for now).
   */
  app.get('/karaoke/:id', requireUser, (c) => {
    const id = c.req.param('id');
    if (!TRACK_ID.test(id)) return c.json({ error: 'bad_track_id' }, 400);
    if (!k) return c.json({ status: 'off' });
    const priority = c.req.query('soon') === '1' ? PRIORITY.soon : PRIORITY.now;
    const job = k.enqueue(c.var.user.id, id, priority);
    if (job.status === 'ready')
      return c.json({ status: 'ready', url: `/api/v1/karaoke/${encodeURIComponent(id)}/audio` });
    if (job.status === 'queued' || job.status === 'working')
      return c.json({ status: job.status, ahead: k.ahead(job) });
    return c.json({ status: job.status }); // failed, or skipped (too long)
  });

  /** The 5.1 file (instrumental front, vocals rear), Range passed through. */
  app.get('/karaoke/:id/audio', requireUser, async (c) => {
    const id = c.req.param('id');
    if (!k || !TRACK_ID.test(id)) return c.json({ error: 'not_found' }, 404);
    const job = k.enqueue(c.var.user.id, id, PRIORITY.now);
    if (job.status !== 'ready') return c.json({ error: 'not_ready', status: job.status }, 409);
    const range = c.req.header('range');
    let res: IncomingMessage;
    try {
      res = await send(`${k.base}/stems/${job.key}`, 'GET', range ? { range } : {});
    } catch {
      return c.json({ error: 'stems_offline' }, 502);
    }
    if (res.statusCode === 404) {
      // Deleted from the disk since: made again.
      res.resume();
      k.mark(job.key, 'queued');
      k.kick();
      return c.json({ error: 'not_ready', status: 'queued' }, 409);
    }
    const headers = new Headers({
      'cache-control': 'private, no-store',
      'content-type': 'audio/mp4',
    });
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = res.headers[h];
      if (typeof v === 'string') headers.set(h, v);
    }
    headers.set('content-security-policy', "sandbox; default-src 'none'");
    return new Response(Readable.toWeb(res) as ReadableStream, {
      status: res.statusCode ?? 502,
      headers,
    });
  });

  return app;
}
