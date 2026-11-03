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
const MAX_RUNNING = 2;
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
  /** Rejects with YtAudioError. */
  resolve(videoId: string): Promise<Resolved>;
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

/** `TMPDIR` is where the standalone binary unpacks itself: the image may have no writable /tmp. */
const execRun =
  (tmp?: string): Run =>
  (bin, args) =>
    new Promise((resolve) => {
      execFile(
        bin,
        args,
        {
          timeout: TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
          env: tmp ? { ...process.env, TMPDIR: tmp } : process.env,
        },
        (err, stdout, stderr) =>
          resolve({
            code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
            stdout: String(stdout),
            stderr: String(stderr || (err ? err.message : '')),
          }),
      );
    });

const codeOf = (stderr: string): YtAudioCode =>
  /Sign in to confirm/.test(stderr)
    ? 'youtube.bot_check'
    : /unavailable|age|private|removed/i.test(stderr)
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
  run?: Run;
}): Resolver {
  const run = opts.run ?? execRun(opts.tmp);
  const done = new Map<string, Resolved>();
  const pending = new Map<string, Promise<Resolved>>();
  const status: YtdlpStatus = { version: null, updatedAt: null, lastError: null };
  let running = 0;
  const waiting: (() => void)[] = [];

  async function slot<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= MAX_RUNNING) await new Promise<void>((r) => waiting.push(r));
    running++;
    try {
      return await fn();
    } finally {
      running--;
      waiting.shift()?.();
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

  return {
    resolve(id) {
      if (!VIDEO_ID.test(id))
        return Promise.reject(new YtAudioError('youtube.unavailable', 'not a video id'));
      const hit = done.get(id);
      if (hit && hit.expiresAt - REUSE_MARGIN_MS > opts.now()) return Promise.resolve(hit);
      const inFlight = pending.get(id);
      if (inFlight) return inFlight;
      const p = slot(() => once(id))
        .then(
          (r) => {
            done.delete(id); // re-inserted last: the oldest go first
            done.set(id, r);
            if (done.size > MAX_CACHED) done.delete(done.keys().next().value as string);
            return r;
          },
          (err: unknown) => {
            const e =
              err instanceof YtAudioError ? err : new YtAudioError('youtube.failed', String(err));
            status.lastError = e.message;
            opts.log('warn', 'yt-dlp failed', { id, code: e.code, detail: e.message });
            throw e;
          },
        )
        .finally(() => pending.delete(id));
      pending.set(id, p);
      return p;
    },
    forget(id) {
      done.delete(id);
    },
    status: () => ({ ...status }),
    note(s) {
      Object.assign(status, s);
    },
  };
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
  run: Run = execRun(),
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
