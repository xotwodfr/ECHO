import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Log } from '../log.ts';

// yt-dlp, the one thing that turns a YouTube video id into an audio URL (spec calls 1 and 4). The
// standalone binary (no Python in the image) runs with Node as its JavaScript runtime and NEVER with
// the user's cookie: yt-dlp's own documentation warns that accounts used with it get banned. A URL
// is bound to this server's IP and expires after about 6 h; it is reused until 30 min before that.
// At most two processes run at once (about 4 s and 2.6 s of CPU each on the OptiPlex).

export const VIDEO_ID = /^[\w-]{11}$/;
const REUSE_MARGIN_MS = 30 * 60_000;
/** A failure is remembered this long: the player's retries and the next prefetch cost no new run. */
const FAIL_TTL_MS = 2 * 60_000;
const MAX_RUNNING = 2;
const MAX_WAITING = 4; // prefetches past this are dropped
const MAX_CACHED = 500;
const TIMEOUT_MS = 30_000;

export interface Resolved {
  url: string;
  size: number;
  expiresAt: number;
  /** yt-dlp's request headers: googlevideo refuses a different User-Agent (403). */
  headers: Record<string, string>;
  /** The URL is refused before this (ms; yt-dlp's `available_at`, a few seconds after extraction). */
  availableAt: number;
}

export interface YtdlpStatus {
  version: string | null;
  updatedAt: number | null;
  lastError: string | null;
}

export type YtAudioCode = 'youtube.unavailable' | 'youtube.bot_check' | 'youtube.failed';

export class YtAudioError extends Error {
  readonly code: YtAudioCode;
  constructor(code: YtAudioCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Resolver {
  /** Rejects with YtAudioError. `urgent`: the song being played, ahead of any waiting work. */
  resolve(videoId: string, opts?: { urgent?: boolean }): Promise<Resolved>;
  /** Resolve ahead, unless a backlog is already waiting (the work would be stale by then). */
  prefetch(videoId: string): void;
  /** Drops the cached URL (it answered 403: expired early, or moved). */
  forget(videoId: string): void;
  status(): YtdlpStatus;
  /** The updater's findings (updateYtdlp). */
  note(s: Partial<YtdlpStatus>): void;
}

export type Run = (
  bin: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

/**
 * `TMPDIR`: where the standalone binary unpacks itself. `XDG_CACHE_HOME`: its cache (YouTube's
 * player code); in the image uid 1000 has no home, so without it yt-dlp fails to create `/.cache`.
 */
export const createRun =
  (dirs: { tmp?: string; cache?: string } = {}): Run =>
  (bin, args) =>
    new Promise((resolve) => {
      execFile(
        bin,
        args,
        {
          timeout: TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
          env: {
            ...process.env,
            ...(dirs.tmp && { TMPDIR: dirs.tmp }),
            ...(dirs.cache && { XDG_CACHE_HOME: dirs.cache }),
          },
        },
        (err, stdout, stderr) =>
          resolve({
            code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
            stdout: String(stdout),
            stderr: String(stderr || (err ? err.message : '')),
          }),
      );
    });

/** A bot check (or YouTube's rate limit) fails every song alike; the player stops on it. */
const codeOf = (stderr: string): YtAudioCode =>
  /Sign in to confirm you.re not a bot|HTTP Error 429/i.test(stderr)
    ? 'youtube.bot_check'
    : /unavailable|confirm your age|age.restricted|private video|removed/i.test(stderr)
      ? 'youtube.unavailable'
      : 'youtube.failed';

/** The last ERROR line, without the noise before it. */
const lastError = (stderr: string) =>
  (
    stderr
      .trim()
      .split('\n')
      .reverse()
      .find((l) => l.startsWith('ERROR')) ?? stderr.trim()
  ).slice(0, 500);

export function createYtdlpResolver(opts: {
  bin: string;
  now: () => number;
  log: Log;
  tmp?: string;
  cache?: string;
  run?: Run;
}): Resolver {
  const run = opts.run ?? createRun({ tmp: opts.tmp, cache: opts.cache });
  const done = new Map<string, Resolved>();
  const failed = new Map<string, { err: YtAudioError; at: number }>();
  const pending = new Map<string, Promise<Resolved>>();
  const status: YtdlpStatus = { version: null, updatedAt: null, lastError: null };
  let running = 0;
  const waiting: (() => void)[] = [];

  /** At most MAX_RUNNING at once; a freed slot is handed straight to the next waiter. */
  async function slot<T>(fn: () => Promise<T>, urgent: boolean): Promise<T> {
    if (running >= MAX_RUNNING)
      await new Promise<void>((r) => (urgent ? waiting.unshift(r) : waiting.push(r)));
    else running++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next)
        next(); // the slot passes on: `running` stays as it is
      else running--;
    }
  }

  async function once(id: string): Promise<Resolved> {
    const args = [
      '--no-config',
      '--no-playlist',
      '--js-runtimes',
      `node:${process.execPath}`,
      '-f',
      '140/bestaudio[ext=m4a]',
      '-j',
      `https://music.youtube.com/watch?v=${id}`,
    ];
    const r = await run(opts.bin, args);
    if (r.code !== 0) throw new YtAudioError(codeOf(r.stderr), lastError(r.stderr));
    const j = JSON.parse(r.stdout) as {
      url?: string;
      filesize?: number | null;
      http_headers?: Record<string, string>;
      available_at?: number | null;
      requested_downloads?: { url?: string; filesize?: number | null }[];
    };
    const url = j.url ?? j.requested_downloads?.[0]?.url;
    if (!url) throw new YtAudioError('youtube.failed', 'yt-dlp gave no URL');
    const q = new URL(url).searchParams;
    const size = j.filesize ?? j.requested_downloads?.[0]?.filesize ?? (Number(q.get('clen')) || 0);
    if (!size) throw new YtAudioError('youtube.failed', 'yt-dlp gave no size');
    return {
      url,
      size,
      expiresAt: Number(q.get('expire')) * 1000,
      headers: j.http_headers ?? {},
      availableAt: (j.available_at ?? 0) * 1000,
    };
  }

  const resolver: Resolver = {
    resolve(id, o = {}) {
      if (!VIDEO_ID.test(id))
        return Promise.reject(new YtAudioError('youtube.unavailable', 'not a video id'));
      const hit = done.get(id);
      if (hit && hit.expiresAt - REUSE_MARGIN_MS > opts.now()) return Promise.resolve(hit);
      const inFlight = pending.get(id);
      if (inFlight) return inFlight;
      const miss = failed.get(id);
      if (miss && opts.now() - miss.at < FAIL_TTL_MS) return Promise.reject(miss.err);
      const p = slot(() => once(id), !!o.urgent)
        .then(
          (r) => {
            failed.delete(id);
            done.delete(id); // re-inserted last: the oldest go first
            done.set(id, r);
            if (done.size > MAX_CACHED) done.delete(done.keys().next().value as string);
            return r;
          },
          (err: unknown) => {
            const e =
              err instanceof YtAudioError ? err : new YtAudioError('youtube.failed', String(err));
            status.lastError = e.message;
            failed.set(id, { err: e, at: opts.now() });
            if (failed.size > MAX_CACHED) failed.delete(failed.keys().next().value as string);
            opts.log('warn', 'yt-dlp failed', { id, code: e.code, detail: e.message });
            throw e;
          },
        )
        .finally(() => pending.delete(id));
      pending.set(id, p);
      return p;
    },
    prefetch(id) {
      if (waiting.length >= MAX_WAITING && !pending.has(id)) return;
      void resolver.resolve(id).catch(() => undefined);
    },
    forget(id) {
      done.delete(id);
      failed.delete(id);
    },
    status: () => ({ ...status }),
    note(s) {
      Object.assign(status, s);
    },
  };
  return resolver;
}

/**
 * The binary that runs: `<dataDir>/bin/yt-dlp`, copied once from the image's pinned one, then kept
 * current by `yt-dlp -U` (which checks the release's checksums). A redeploy is not needed when
 * YouTube breaks yt-dlp; the next daily update brings the fix.
 */
export function ensureBinary(bundled: string, dataDir: string): string {
  const bin = join(dataDir, 'bin', 'yt-dlp');
  if (!existsSync(bin)) {
    mkdirSync(join(dataDir, 'bin'), { recursive: true });
    copyFileSync(bundled, bin);
  }
  chmodSync(bin, 0o755);
  return bin;
}

/** `yt-dlp -U`, then its version; both recorded for the admin page. Never throws. */
export async function updateYtdlp(
  bin: string,
  r: Resolver,
  run: Run = createRun(),
  now: () => number = Date.now,
): Promise<void> {
  const u = await run(bin, ['-U']).catch((e: unknown) => ({
    code: 1,
    stdout: '',
    stderr: String(e),
  }));
  const v = await run(bin, ['--version']).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  r.note({
    ...(v.code === 0 && { version: v.stdout.trim() }),
    ...(u.code === 0 ? { updatedAt: now() } : { lastError: lastError(u.stderr) }),
  });
}
