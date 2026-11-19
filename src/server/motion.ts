import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { requireAdmin } from './admin.ts';
import { audit } from './audit.ts';
import type { AuthEnv } from './auth/routes.ts';
import type { Db } from './db/db.ts';
import { readJson, send } from './karaoke.ts';
import type { Log } from './log.ts';
import type { SubsonicClient } from './navidrome/client.ts';

// Animated lock-screen covers (docs/MOTION.md): a short looping video per album, tall (3:4) and
// square, each with its first frame as a still, for the iPhone app's lock screen. An admin can
// upload a video for an album (kept in /data/motion); otherwise the motion service (motion/) makes
// one from the album's still cover the first time it is asked for. ECHO keeps the queue, one cover
// at a time like Karaoke's, and the cap on what generated covers may take on the service's disk;
// the files live there and ECHO proxies them to signed-in users.

/** The loop lengths the apps may ask for (their speed setting), in seconds: few, so the cache stays bounded. */
export const LOOPS = [5, 8, 12, 15] as const;
export const DEFAULT_LOOP = 8;
export const SHAPES = ['tall', 'square'] as const;
export const PRIORITY = { asked: 5, upload: 10 } as const;
/** An uploaded video's size limit (SETTINGS_AND_SECURITY.md §5.6). */
export const UPLOAD_MAX = 50 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RETRY_MS = 10 * 60_000;
const OFFLINE_MS = 60_000; // the motion service is down (restarting, not deployed yet): wait and ask again
const RETRY_FAILED_MS = 7 * 86_400_000; // a cover that failed is tried again when asked a week later
/** Generated covers one user may have waiting at once: enough for a queue of albums, not a library. */
const MAX_WAITING_PER_USER = 20;
const ALBUM_ID = /^[\w.:-]{1,200}$/;
/** What an upload is stored as, by its declared type. */
const TYPES: Record<string, 'mp4' | 'mov' | 'm4v'> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
};

export type Shape = (typeof SHAPES)[number];
export type JobStatus = 'queued' | 'working' | 'ready' | 'failed';

export interface MotionDeps {
  db: Db;
  now: () => number;
  log?: Log;
  /** The motion service, e.g. http://echo-motion:8091. */
  motionUrl: string;
  /** Where uploaded videos are kept (<data>/motion). */
  dir: string;
  /** What generated covers may take on the motion service's disk, in bytes; uploads are not counted. */
  cacheBytes: number;
  /** An upload's size limit (tests make it small). */
  uploadMax?: number;
  scopeFor: (userId: number) => string;
  navidrome: (userId: number) => Promise<SubsonicClient | null>;
}

export interface Job {
  key: string;
  scope: string;
  album_id: string;
  variant: string; // 'g5' | 'g8' | 'g12' | 'g15' (generated, the loop's seconds), or 'u' (the upload)
  user_id: number | null;
  status: JobStatus;
  priority: number;
  attempts: number;
  error: string | null;
  style: string | null;
  bytes: number;
  seconds: number | null;
  took_ms: number | null;
  used_at: number;
  created_at: number;
  updated_at: number;
}

export interface Upload {
  scope: string;
  album_id: string;
  id: string;
  file: string;
  type: string;
  bytes: number;
  uploaded_by: number | null;
  uploaded_at: number;
}

/** The motion service's name for a cover: one per Navidrome server, album and variant, nothing readable. */
export const motionKey = (scope: string, albumId: string, variant: string) =>
  createHash('sha256').update(`motion|${scope}|${albumId}|${variant}`).digest('hex').slice(0, 40);

/**
 * The container an upload's first bytes announce: an ISO base media file (`ftyp` with a video
 * brand: MP4, M4V, QuickTime) or a QuickTime movie from before `ftyp` (its first atom `moov`,
 * `mdat`, `wide`, `free` or `skip`). HEIF and AVIF images and M4A audio share the format and are
 * refused here; the motion service's ffprobe is the real check.
 */
export function videoContainer(head: Buffer): 'iso' | 'quicktime' | null {
  if (head.length < 12) return null;
  const size = head.readUInt32BE(0);
  const type = head.toString('latin1', 4, 8);
  if (type === 'ftyp') {
    if (size < 16 || size > 4096) return null;
    const brands = [head.toString('latin1', 8, 12)];
    for (let i = 16; i + 4 <= Math.min(size, head.length); i += 4)
      brands.push(head.toString('latin1', i, i + 4));
    const [major] = brands;
    if (NOT_VIDEO.has(major as string)) return null;
    return brands.some((b) => VIDEO_BRANDS.has(b)) ? 'iso' : null;
  }
  return size >= 8 && ['moov', 'mdat', 'wide', 'free', 'skip'].includes(type) ? 'quicktime' : null;
}
const VIDEO_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'hvc1',
  'M4V ',
  'M4VH',
  'M4VP',
  'qt  ',
  'MSNV',
]);
const NOT_VIDEO = new Set(['mif1', 'msf1', 'heic', 'heix', 'avif', 'avis', 'M4A ', 'M4B ', 'M4P ']);

class Offline extends Error {}
/** The service could not use what it was sent (a cover nothing reads, a video it refuses): not retried. */
class Refused extends Error {}

export function createMotion(deps: MotionDeps) {
  const { db, now } = deps;
  const log: Log = deps.log ?? (() => {});
  const base = deps.motionUrl.replace(/\/+$/, '');
  const uploadMax = deps.uploadMax ?? UPLOAD_MAX;
  let busy = false;
  let pausedUntil = 0;
  let stopped = false;

  // A job left "working" by a restart is simply queued again.
  db.prepare("UPDATE motion_jobs SET status = 'queued' WHERE status = 'working'").run();

  const get = (key: string) =>
    db.prepare('SELECT * FROM motion_jobs WHERE key = ?').get(key) as Job | undefined;
  const uploadOf = (scope: string, albumId: string) =>
    db
      .prepare('SELECT * FROM motion_uploads WHERE scope = ? AND album_id = ?')
      .get(scope, albumId) as Upload | undefined;
  const uploadJob = (scope: string, albumId: string) =>
    db
      .prepare("SELECT * FROM motion_jobs WHERE scope = ? AND album_id = ? AND variant = 'u'")
      .get(scope, albumId) as Job | undefined;

  function insert(
    job: Omit<Job, 'attempts' | 'error' | 'style' | 'bytes' | 'seconds' | 'took_ms'>,
  ) {
    db.prepare(
      `INSERT INTO motion_jobs (key, scope, album_id, variant, user_id, status, priority, used_at,
         created_at, updated_at)
       VALUES (@key, @scope, @album_id, @variant, @user_id, @status, @priority, @used_at,
         @created_at, @updated_at)`,
    ).run(job);
  }

  /**
   * The cover a user gets for an album at this loop length: the admin's upload when there is one,
   * else the generated one, queued if it is not made yet (null: too many of theirs waiting).
   */
  function jobFor(userId: number, albumId: string, loop: number): Job | null {
    const scope = deps.scopeFor(userId);
    const t = now();
    // An upload that could not be converted leaves the album to a generated cover meanwhile.
    const up = uploadJob(scope, albumId);
    const key = up && up.status !== 'failed' ? up.key : motionKey(scope, albumId, `g${loop}`);
    const had = get(key);
    if (!had) {
      const waiting = db
        .prepare(
          "SELECT COUNT(*) FROM motion_jobs WHERE user_id = ? AND status = 'queued' AND variant != 'u'",
        )
        .pluck()
        .get(userId) as number;
      if (waiting >= MAX_WAITING_PER_USER) return null;
      insert({
        key,
        scope,
        album_id: albumId,
        variant: `g${loop}`,
        user_id: userId,
        status: 'queued',
        priority: PRIORITY.asked,
        used_at: t,
        created_at: t,
        updated_at: t,
      });
      kick();
    } else if (
      had.status === 'failed' &&
      had.variant !== 'u' &&
      had.updated_at <= t - RETRY_FAILED_MS
    ) {
      // Asked for again a week on: the service may have been fixed since.
      db.prepare(
        `UPDATE motion_jobs SET status = 'queued', attempts = 0, error = NULL, next_at = 0,
           user_id = ?, updated_at = ? WHERE key = ?`,
      ).run(userId, t, key);
      kick();
    }
    db.prepare('UPDATE motion_jobs SET used_at = ? WHERE key = ?').run(t, key);
    return get(key) as Job;
  }

  /** Covers ahead of this one in the queue (in next()'s order). */
  const ahead = (job: Job) =>
    db
      .prepare(
        `SELECT COUNT(*) FROM motion_jobs AS o, (SELECT rowid AS r FROM motion_jobs WHERE key = ?) AS me
         WHERE o.status IN ('queued', 'working') AND o.key != ? AND (o.status = 'working'
           OR o.priority > ? OR (o.priority = ? AND (o.created_at < ? OR (o.created_at = ? AND o.rowid < me.r))))`,
      )
      .pluck()
      .get(job.key, job.key, job.priority, job.priority, job.created_at, job.created_at) as number;

  /** Seconds a client should wait before asking again: the covers ahead at the recent pace. */
  function retryAfter(job: Job) {
    const pace = db
      .prepare(
        `SELECT AVG(took_ms) FROM (SELECT took_ms FROM motion_jobs WHERE took_ms IS NOT NULL
           ORDER BY updated_at DESC LIMIT 20)`,
      )
      .pluck()
      .get() as number | null;
    const each = (pace ?? 30_000) / 1000;
    return Math.min(600, Math.max(5, Math.round((ahead(job) + 1) * each)));
  }

  const next = () =>
    db
      .prepare(
        `SELECT * FROM motion_jobs WHERE status = 'queued' AND next_at <= ?
         ORDER BY priority DESC, created_at, rowid LIMIT 1`,
      )
      .get(now()) as Job | undefined;

  const mark = (key: string, status: JobStatus, extra: Partial<Job> & { next_at?: number } = {}) =>
    db
      .prepare(
        `UPDATE motion_jobs SET status = @status, error = @error,
           attempts = COALESCE(@attempts, attempts), style = COALESCE(@style, style),
           bytes = COALESCE(@bytes, bytes), seconds = COALESCE(@seconds, seconds),
           took_ms = COALESCE(@took_ms, took_ms), next_at = @next_at, updated_at = @t
         WHERE key = @key`,
      )
      .run({
        key,
        status,
        error: extra.error ?? null,
        attempts: extra.attempts ?? null,
        style: extra.style ?? null,
        bytes: extra.bytes ?? null,
        seconds: extra.seconds ?? null,
        took_ms: extra.took_ms ?? null,
        next_at: extra.next_at ?? 0,
        t: now(),
      });

  /** A PUT to the service; its JSON answer, or Offline / Refused / Error. */
  async function put(path: string, body: Readable, length?: number) {
    let res: IncomingMessage;
    try {
      res = await send(
        `${base}${path}`,
        'PUT',
        length !== undefined
          ? { 'content-length': String(length) }
          : { 'transfer-encoding': 'chunked' },
        body,
      );
    } catch (err) {
      body.destroy();
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH'].includes(code))
        throw new Offline(code);
      throw err;
    }
    const out = await readJson(res);
    if (res.statusCode === 422)
      throw new Refused(String(out.detail ?? out.error ?? 'refused').slice(0, 200));
    if (res.statusCode !== 200) throw new Error(String(out.error ?? `HTTP ${res.statusCode}`));
    return out as { bytes?: number; seconds?: number; style?: string; took?: number };
  }

  async function run(job: Job) {
    if (job.variant === 'u') {
      const up = uploadOf(job.scope, job.album_id);
      if (!up) throw new Refused('upload_removed');
      return put(`/transcode/${job.key}`, createReadStream(join(deps.dir, up.file)), up.bytes);
    }
    const client =
      job.user_id !== null ? await deps.navidrome(job.user_id).catch(() => null) : null;
    if (!client) throw new Error('navidrome_unavailable');
    const album = await client
      .call('getAlbum', { id: job.album_id })
      .then((r) => r.album as { coverArt?: string } | undefined)
      .catch(() => undefined);
    if (!album) throw new Refused('no_such_album');
    const src = await client.request('getCoverArt', {
      id: album.coverArt ?? job.album_id,
      size: '1440',
    });
    const type = String(src.headers['content-type'] ?? '');
    if ((src.statusCode ?? 500) >= 400 || !type.startsWith('image/') || type.includes('svg')) {
      src.resume();
      throw new Refused('no_cover');
    }
    const length = src.headers['content-length'];
    return put(
      `/render/${job.key}?loop=${job.variant.slice(1)}`,
      src,
      length ? Number(length) : undefined,
    );
  }

  /** The service's files for a cover go (best effort: an offline service keeps them). */
  async function drop(key: string) {
    try {
      (await send(`${base}/motion/${key}`, 'DELETE')).resume();
      return true;
    } catch {
      return false;
    }
  }

  /** Generated covers over the cap go, those asked for longest ago first (uploads are kept). */
  async function evict(keep: string) {
    let total = db
      .prepare(
        "SELECT COALESCE(SUM(bytes), 0) FROM motion_jobs WHERE status = 'ready' AND variant != 'u'",
      )
      .pluck()
      .get() as number;
    while (total > deps.cacheBytes) {
      const old = db
        .prepare(
          `SELECT key, bytes FROM motion_jobs WHERE status = 'ready' AND variant != 'u' AND key != ?
           ORDER BY used_at, key LIMIT 1`,
        )
        .get(keep) as { key: string; bytes: number } | undefined;
      if (!old || !(await drop(old.key))) break;
      db.prepare('DELETE FROM motion_jobs WHERE key = ?').run(old.key);
      total -= old.bytes;
      log('info', 'motion: cover let go (cache full)', { bytes: old.bytes });
    }
  }

  async function loop() {
    if (busy || stopped) return;
    busy = true;
    try {
      while (!stopped && now() >= pausedUntil) {
        const job = next();
        if (!job) break;
        mark(job.key, 'working');
        try {
          const r = await run(job);
          if (!get(job.key)) {
            await drop(job.key); // removed while it was made (an upload replaced or deleted it)
            continue;
          }
          mark(job.key, 'ready', {
            bytes: Number(r.bytes ?? 0),
            seconds: Number(r.seconds ?? 0),
            style: String(r.style ?? ''),
            took_ms: Math.round(Number(r.took ?? 0) * 1000),
          });
          log('info', 'motion: cover made', { style: r.style, seconds: r.took, bytes: r.bytes });
          if (job.variant !== 'u') await evict(job.key);
        } catch (err) {
          if (!get(job.key)) continue;
          if (err instanceof Offline) {
            mark(job.key, 'queued');
            pausedUntil = now() + OFFLINE_MS;
            log('warn', 'motion: the motion service is not reachable', { detail: err.message });
            break;
          }
          const error = String((err as Error).message ?? err).slice(0, 200);
          const attempts = job.attempts + 1;
          const done = err instanceof Refused || attempts >= MAX_ATTEMPTS;
          mark(job.key, done ? 'failed' : 'queued', {
            attempts,
            error,
            ...(!done && { next_at: now() + RETRY_MS * attempts }),
          });
          log('warn', 'motion: cover failed', { attempts, error });
        }
      }
    } finally {
      busy = false;
    }
  }
  function kick() {
    void loop();
  }

  /** Every job of an album except [keep], with their files on the service. */
  async function dropAlbum(scope: string, albumId: string, keep?: string) {
    const keys = db
      .prepare('SELECT key FROM motion_jobs WHERE scope = ? AND album_id = ? AND key != ?')
      .pluck()
      .all(scope, albumId, keep ?? '') as string[];
    for (const key of keys) {
      db.prepare('DELETE FROM motion_jobs WHERE key = ?').run(key);
      await drop(key);
    }
  }

  /**
   * An admin's video becomes the album's motion cover (on the admin's own Navidrome server): the
   * file kept, the album's other covers dropped, its transcode queued first.
   */
  async function upload(userId: number, albumId: string, tmp: string, type: string, bytes: number) {
    const scope = deps.scopeFor(userId);
    const id = randomBytes(12).toString('hex');
    const file = `${id}.${type}`;
    await rename(tmp, join(deps.dir, file));
    const old = uploadOf(scope, albumId);
    const t = now();
    db.prepare(
      `INSERT INTO motion_uploads (scope, album_id, id, file, type, bytes, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (scope, album_id) DO UPDATE SET id = excluded.id, file = excluded.file,
         type = excluded.type, bytes = excluded.bytes, uploaded_by = excluded.uploaded_by,
         uploaded_at = excluded.uploaded_at`,
    ).run(scope, albumId, id, file, type, bytes, userId, t);
    const key = motionKey(scope, albumId, `u-${id}`);
    insert({
      key,
      scope,
      album_id: albumId,
      variant: 'u',
      user_id: userId,
      status: 'queued',
      priority: PRIORITY.upload,
      used_at: t,
      created_at: t,
      updated_at: t,
    });
    await dropAlbum(scope, albumId, key);
    if (old) await rm(join(deps.dir, old.file), { force: true });
    kick();
    return get(key) as Job;
  }

  /** The album's upload goes (file, row, its transcode); a generated cover follows when asked for. */
  async function removeUpload(userId: number, albumId: string) {
    const scope = deps.scopeFor(userId);
    const up = uploadOf(scope, albumId);
    if (!up) return null;
    db.prepare('DELETE FROM motion_uploads WHERE scope = ? AND album_id = ?').run(scope, albumId);
    const job = uploadJob(scope, albumId);
    if (job) {
      db.prepare('DELETE FROM motion_jobs WHERE key = ?').run(job.key);
      await drop(job.key);
    }
    await rm(join(deps.dir, up.file), { force: true });
    return up;
  }

  function counts() {
    const rows = db
      .prepare('SELECT status, COUNT(*) AS n FROM motion_jobs GROUP BY status')
      .all() as { status: JobStatus; n: number }[];
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
      Record<JobStatus, number>
    >;
    const sums = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN variant != 'u' THEN bytes END), 0) AS generated,
           COALESCE(SUM(CASE WHEN variant = 'u' THEN bytes END), 0) AS uploaded
         FROM motion_jobs WHERE status = 'ready'`,
      )
      .get() as { generated: number; uploaded: number };
    return {
      ready: by.ready ?? 0,
      queued: (by.queued ?? 0) + (by.working ?? 0),
      failed: by.failed ?? 0,
      uploads: db.prepare('SELECT COUNT(*) FROM motion_uploads').pluck().get() as number,
      bytes: sums.generated + sums.uploaded,
      cacheBytes: deps.cacheBytes,
    };
  }

  /** Whether the motion service answers. */
  async function online() {
    try {
      const res = await send(`${base}/health`, 'GET');
      res.resume();
      return res.statusCode === 200;
    } catch {
      return false;
    }
  }

  /** A cover's file from the service (Range passed through), or null when it is gone. */
  async function file(job: Job, name: string, range?: string) {
    const res = await send(`${base}/motion/${job.key}/${name}`, 'GET', range ? { range } : {});
    if (res.statusCode === 404) {
      // Deleted from the service's disk since: made again.
      res.resume();
      mark(job.key, 'queued');
      kick();
      return null;
    }
    return res;
  }

  return {
    jobFor,
    ahead,
    retryAfter,
    get,
    uploadOf,
    uploadJob,
    upload,
    removeUpload,
    counts,
    online,
    file,
    kick,
    scopeFor: deps.scopeFor,
    dir: deps.dir,
    uploadMax,
    stop() {
      stopped = true;
    },
  };
}

export type Motion = ReturnType<typeof createMotion>;

/** shape and loop from the query, or null when either is not one the apps may ask for. */
function params(c: Context) {
  const shape = (c.req.query('shape') ?? 'tall') as Shape;
  const loop = Number(c.req.query('loop') ?? DEFAULT_LOOP);
  if (!SHAPES.includes(shape) || !(LOOPS as readonly number[]).includes(loop)) return null;
  return { shape, loop };
}

const urls = (albumId: string, shape: Shape, loop: number) => {
  const q = `shape=${shape}&loop=${loop}`;
  const a = encodeURIComponent(albumId);
  return { video: `/api/v1/motion/${a}/video?${q}`, still: `/api/v1/motion/${a}/still?${q}` };
};

/** A cover's version: it changes when the cover is made again or replaced. */
const versionOf = (job: Job) => `${job.key.slice(0, 12)}-${job.updated_at.toString(36)}`;

/** Reads an upload's body into [dest], at most [max] bytes; the count, or -1 if it was larger. */
async function receive(body: ReadableStream<Uint8Array>, dest: string, max: number) {
  let n = 0;
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      n += chunk.length;
      done(n > max ? new Error('too_large') : null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(body as never),
      count,
      createWriteStream(dest, { mode: 0o600 }),
    );
  } catch (err) {
    await rm(dest, { force: true });
    if (n > max) return -1;
    throw err;
  }
  return n;
}

async function head(path: string) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export function motionRoutes(
  m: Motion | null,
  requireUser: MiddlewareHandler<AuthEnv>,
  deps: { db: Db; now: () => number },
) {
  const app = new Hono<AuthEnv>();
  const admin = [requireUser, requireAdmin] as const;

  /** Not ready: 202, how many are ahead and when to ask again; the app shows the still cover meanwhile. */
  function pending(c: Context<AuthEnv>, job: Job | null) {
    if (!job) {
      c.header('retry-after', '60');
      return c.json({ error: 'busy', retryAfter: 60 }, 429);
    }
    if (job.status === 'failed') return c.json({ status: 'failed' }, 404);
    const wait = (m as Motion).retryAfter(job);
    c.header('retry-after', String(wait));
    return c.json({ status: job.status, ahead: (m as Motion).ahead(job), retryAfter: wait }, 202);
  }

  /** The album id (on the user's own Navidrome server), or the answer to give instead. */
  function album(c: Context<AuthEnv>): string | Response {
    const albumId = c.req.param('albumId') ?? '';
    if (!ALBUM_ID.test(albumId)) return c.json({ error: 'bad_album_id' }, 400);
    if (m && m.scopeFor(c.var.user.id) === 'none')
      return c.json({ code: 'navidrome.not_connected' }, 409);
    return albumId;
  }

  app.get('/motion', requireUser, async (c) => {
    if (!m) return c.json({ enabled: false });
    return c.json({ enabled: true, online: await m.online(), ...m.counts(), loops: LOOPS });
  });

  /** The album's motion cover: ready (with its video and still), or queued by asking. */
  app.get('/motion/:albumId', requireUser, (c) => {
    const albumId = album(c);
    if (typeof albumId !== 'string') return albumId;
    const p = params(c);
    if (!p) return c.json({ error: 'bad_params' }, 400);
    if (!m) return c.json({ status: 'off' });
    const job = m.jobFor(c.var.user.id, albumId, p.loop);
    if (job?.status !== 'ready') {
      if (job?.status === 'failed') return c.json({ status: 'failed' });
      return pending(c, job);
    }
    return c.json({
      status: 'ready',
      source: job.variant === 'u' ? 'upload' : 'generated',
      style: job.style,
      shape: p.shape,
      seconds: job.seconds,
      version: versionOf(job),
      ...urls(albumId, p.shape, p.loop),
    });
  });

  /** The video (MP4, Range) or its first frame (JPEG), cached by the client for a day. */
  const media = (kind: 'video' | 'still') => async (c: Context<AuthEnv>) => {
    const albumId = album(c);
    if (typeof albumId !== 'string') return albumId;
    const p = params(c);
    if (!p) return c.json({ error: 'bad_params' }, 400);
    if (!m) return c.json({ error: 'off' }, 404);
    const job = m.jobFor(c.var.user.id, albumId, p.loop);
    if (job?.status !== 'ready') return pending(c, job);
    const etag = `"${versionOf(job)}-${p.shape}-${kind}"`;
    const caching = {
      'cache-control': 'private, max-age=86400',
      etag,
      'last-modified': new Date(job.updated_at).toUTCString(),
    };
    const want = c.req.header('if-none-match');
    if (want?.split(',').some((t) => t.trim().replace(/^W\//, '') === etag))
      return new Response(null, { status: 304, headers: caching });
    let res: IncomingMessage | null;
    try {
      res = await m.file(
        job,
        `${p.shape}.${kind === 'video' ? 'mp4' : 'jpg'}`,
        c.req.header('range'),
      );
    } catch {
      return c.json({ error: 'motion_offline' }, 502);
    }
    if (!res) return pending(c, m.get(job.key) ?? null);
    const headers = new Headers({
      ...caching,
      'content-type': kind === 'video' ? 'video/mp4' : 'image/jpeg',
      'content-security-policy': "sandbox; default-src 'none'",
    });
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = res.headers[h];
      if (typeof v === 'string') headers.set(h, v);
    }
    return new Response(Readable.toWeb(res) as ReadableStream, {
      status: res.statusCode ?? 502,
      headers,
    });
  };
  app.get('/motion/:albumId/video', requireUser, media('video'));
  app.get('/motion/:albumId/still', requireUser, media('still'));

  /** The album's uploaded video, if any, and how its transcode went (admins: the album page's menu). */
  app.get('/motion/:albumId/upload', ...admin, (c) => {
    const albumId = album(c);
    if (typeof albumId !== 'string') return albumId;
    if (!m) return c.json({ enabled: false, upload: null });
    const scope = m.scopeFor(c.var.user.id);
    const up = m.uploadOf(scope, albumId);
    const job = m.uploadJob(scope, albumId);
    return c.json({
      enabled: true,
      upload: up
        ? {
            type: up.type,
            bytes: up.bytes,
            uploadedAt: up.uploaded_at,
            status: job?.status ?? 'failed',
            ...(job?.error && { error: job.error }),
          }
        : null,
    });
  });

  /** An admin uploads a video (the body: MP4, M4V or QuickTime, at most 50 MB) as the album's motion cover. */
  app.put('/motion/:albumId/upload', ...admin, async (c) => {
    const albumId = album(c);
    if (typeof albumId !== 'string') return albumId;
    if (!m) return c.json({ error: 'motion_off' }, 409);
    const type =
      TYPES[(c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''];
    if (!type) return c.json({ error: 'unsupported_type' }, 415);
    const declared = Number(c.req.header('content-length') ?? Number.NaN);
    if (declared > m.uploadMax) return c.json({ error: 'too_large' }, 413);
    const body = c.req.raw.body;
    if (!body) return c.json({ error: 'not_a_video' }, 415);
    await mkdir(m.dir, { recursive: true });
    const tmp = join(m.dir, `.upload-${randomBytes(8).toString('hex')}.part`);
    const bytes = await receive(body, tmp, m.uploadMax);
    if (bytes < 0) return c.json({ error: 'too_large' }, 413);
    if (videoContainer(await head(tmp)) === null) {
      await rm(tmp, { force: true });
      return c.json({ error: 'not_a_video' }, 415);
    }
    const job = await m.upload(c.var.user.id, albumId, tmp, type, bytes);
    audit(deps.db, deps.now(), c.var.user.id, 'admin.motion_uploaded', {
      albumId: albumId,
      type,
      bytes,
    });
    return c.json({ status: job.status, type, bytes }, 201);
  });

  app.delete('/motion/:albumId/upload', ...admin, async (c) => {
    const albumId = album(c);
    if (typeof albumId !== 'string') return albumId;
    if (!m) return c.json({ error: 'motion_off' }, 409);
    const up = await m.removeUpload(c.var.user.id, albumId);
    if (!up) return c.json({ error: 'not_found' }, 404);
    audit(deps.db, deps.now(), c.var.user.id, 'admin.motion_removed', { albumId: albumId });
    return c.json({ ok: true });
  });

  return app;
}

/** Uploads left half-written by a restart. */
export async function tidyUploads(dir: string) {
  for (const f of await readdir(dir).catch(() => [] as string[]))
    if (f.startsWith('.upload-')) await rm(join(dir, f), { force: true });
}
