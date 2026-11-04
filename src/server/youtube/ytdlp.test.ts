import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createYtdlpResolver, ensureBinary, updateYtdlp, YtAudioError } from './ytdlp.ts';

// The yt-dlp resolver (spec calls 1 and 4): anonymous, cached until shortly before the URL expires,
// at most two processes at once, and one process for the same song asked twice.

const ID = 'fJ9rUzIMcZQ';
const EXPIRE_S = 1_793_752_364;
const json = (id: string) =>
  JSON.stringify({
    id,
    url: `https://rr6---sn-x.googlevideo.com/videoplayback?expire=${EXPIRE_S}&id=${id}&itag=140&clen=5818745`,
    filesize: 5_818_745,
  });

function fakeRun(answer: (args: string[]) => { code: number; stdout: string; stderr: string }) {
  const calls: string[][] = [];
  let active = 0;
  let maxActive = 0;
  const run = async (_bin: string, args: string[]) => {
    calls.push(args);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return answer(args);
  };
  return { run, calls, max: () => maxActive };
}

const idOf = (args: string[]) => (args.at(-1) ?? '').split('v=')[1] ?? '';
const ok = (args: string[]) => ({ code: 0, stdout: json(idOf(args)), stderr: '' });

describe('the yt-dlp resolver', () => {
  // Measured 2026-11-04: the visionOS client alone gives format 140 in ~1.7 s and its URL plays at
  // once; the default clients take ~3.4 s and their 140 is refused for ~4.7 s more.
  it('asks as visionOS first, for format 140 only', async () => {
    const f = fakeRun(ok);
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    await r.resolve(ID);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('youtube:player_client=visionos');
    expect(f.calls[0]?.[f.calls[0].indexOf('-f') + 1]).toBe('140');
  });

  it('falls back to the default clients when visionOS gives nothing', async () => {
    const f = fakeRun((args) =>
      args.includes('youtube:player_client=visionos')
        ? { code: 1, stdout: '', stderr: 'ERROR: [youtube] x: Requested format is not available' }
        : ok(args),
    );
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    expect((await r.resolve(ID)).size).toBe(5_818_745);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]).not.toContain('youtube:player_client=visionos');
    expect(f.calls[1]).toContain('140/bestaudio[ext=m4a]');
  });

  it('a bot check or a song that is truly gone is not asked again', async () => {
    for (const [stderr, code] of [
      ['ERROR: [youtube] x: Sign in to confirm you’re not a bot', 'youtube.bot_check'],
      ['ERROR: [youtube] x: Video unavailable', 'youtube.unavailable'],
    ] as const) {
      const f = fakeRun(() => ({ code: 1, stdout: '', stderr }));
      const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
      await expect(r.resolve(ID)).rejects.toMatchObject({ code });
      expect(f.calls).toHaveLength(1);
    }
  });

  it('resolves url, size and expiry', async () => {
    const f = fakeRun(ok);
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    const got = await r.resolve(ID);
    expect(got.url).toContain('googlevideo.com/videoplayback');
    expect(got.size).toBe(5_818_745);
    expect(got.expiresAt).toBe(EXPIRE_S * 1000);
  });

  // Live 2026-11-03: googlevideo answers 403 unless the request carries yt-dlp's own User-Agent, and
  // before `available_at` (a few seconds after extraction).
  it('keeps the headers and the time the URL becomes usable', async () => {
    const f = fakeRun((args) => {
      const j = JSON.parse(json(idOf(args)));
      j.http_headers = { 'User-Agent': 'Mozilla/5.0 Chrome/150', Accept: '*/*' };
      j.available_at = 1_793_733_464;
      return { code: 0, stdout: JSON.stringify(j), stderr: '' };
    });
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    const got = await r.resolve(ID);
    expect(got.headers).toEqual({ 'User-Agent': 'Mozilla/5.0 Chrome/150', Accept: '*/*' });
    expect(got.availableAt).toBe(1_793_733_464_000);
  });

  it('takes the size from clen when yt-dlp gives none', async () => {
    const f = fakeRun((args) => {
      const j = JSON.parse(json(idOf(args)));
      j.filesize = null;
      return { code: 0, stdout: JSON.stringify(j), stderr: '' };
    });
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    expect((await r.resolve(ID)).size).toBe(5_818_745);
  });

  it('rejects a bad video id without running yt-dlp', async () => {
    const f = fakeRun(ok);
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    await expect(r.resolve('../etc/passwd')).rejects.toBeInstanceOf(YtAudioError);
    await expect(r.resolve('--exec=sh x')).rejects.toBeInstanceOf(YtAudioError);
    expect(f.calls).toHaveLength(0);
  });

  it('dedupes and caps concurrency', async () => {
    const f = fakeRun(ok);
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa', 'ddddddddddd'];
    const got = await Promise.all(ids.map((id) => r.resolve(id)));
    expect(got[0]).toBe(got[3]);
    expect(f.calls).toHaveLength(4);
    expect(f.max()).toBeLessThanOrEqual(2);
  });

  // Review 2026-11-03: prepare-ahead took both slots before the song being played asked for its own.
  it('an urgent resolve jumps the queue', async () => {
    const f = fakeRun(ok);
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'];
    const all = ids.map((id) => r.resolve(id));
    all.push(r.resolve('eeeeeeeeeee', { urgent: true }));
    await Promise.all(all);
    expect(f.calls.map(idOf)).toEqual([
      'aaaaaaaaaaa',
      'bbbbbbbbbbb',
      'eeeeeeeeeee',
      'ccccccccccc',
      'ddddddddddd',
    ]);
  });

  it('prefetch drops work past a short backlog', async () => {
    const f = fakeRun(ok);
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    const ids = 'abcdefghijkl'.split('').map((c) => c.repeat(11));
    for (const id of ids) r.prefetch(id);
    await new Promise((done) => setTimeout(done, 100));
    // Two running, eight waiting (a page's six and the queue's next two); the rest dropped.
    expect(f.calls).toHaveLength(10);
    expect(f.max()).toBeLessThanOrEqual(2);
  });

  it('reuses until 30 min before expiry', async () => {
    const f = fakeRun(ok);
    let t = 0;
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => t, log: () => {}, run: f.run });
    await r.resolve(ID);
    t = EXPIRE_S * 1000 - 31 * 60_000;
    await r.resolve(ID);
    expect(f.calls).toHaveLength(1);
    t = EXPIRE_S * 1000 - 29 * 60_000;
    await r.resolve(ID);
    expect(f.calls).toHaveLength(2);
  });

  it('forget drops the cached URL', async () => {
    const f = fakeRun(ok);
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    await r.resolve(ID);
    r.forget(ID);
    await r.resolve(ID);
    expect(f.calls).toHaveLength(2);
  });

  // Review 2026-11-03: a failure was retried by the player 3 times, each a new yt-dlp run (and on
  // a bot check, for every song in the queue); it is remembered for two minutes instead.
  it('a failure is remembered for two minutes', async () => {
    let t = 0;
    let first = true;
    const f = fakeRun((args) => {
      if (!first) return ok(args);
      first = false;
      return {
        code: 1,
        stdout: '',
        stderr: "ERROR: [youtube] x: Sign in to confirm you're not a bot",
      };
    });
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => t, log: () => {}, run: f.run });
    const err = await r.resolve(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YtAudioError);
    expect((err as YtAudioError).code).toBe('youtube.bot_check');
    expect(r.status().lastError).toContain('Sign in to confirm');
    t = 119_000;
    expect(((await r.resolve(ID).catch((e: unknown) => e)) as YtAudioError).code).toBe(
      'youtube.bot_check',
    );
    expect(f.calls).toHaveLength(1);
    t = 121_000;
    await r.resolve(ID);
    expect(f.calls).toHaveLength(2);
  });

  it('a 429 is a bot check; a mere "webpage" is not unavailable', async () => {
    const code = async (stderr: string) => {
      const f = fakeRun(() => ({ code: 1, stdout: '', stderr }));
      const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
      return ((await r.resolve(ID).catch((e: unknown) => e)) as YtAudioError).code;
    };
    expect(await code('ERROR: [youtube] x: Unable to download webpage: HTTP Error 429')).toBe(
      'youtube.bot_check',
    );
    expect(await code('ERROR: [youtube] x: Unable to download webpage: timed out')).toBe(
      'youtube.failed',
    );
    expect(await code('ERROR: [youtube] x: Sign in to confirm your age')).toBe(
      'youtube.unavailable',
    );
  });

  it('names unavailable songs', async () => {
    const f = fakeRun(() => ({
      code: 1,
      stdout: '',
      stderr: 'ERROR: [youtube] x: Video unavailable. This video is private',
    }));
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    expect(((await r.resolve(ID).catch((e: unknown) => e)) as YtAudioError).code).toBe(
      'youtube.unavailable',
    );
  });

  it('never passes cookies', async () => {
    const f = fakeRun(ok);
    const r = createYtdlpResolver({ bin: 'yt-dlp', now: () => 0, log: () => {}, run: f.run });
    await r.resolve(ID);
    expect(f.calls[0]).toEqual([
      '--no-config',
      '--no-playlist',
      '--js-runtimes',
      `node:${process.execPath}`,
      '--extractor-args',
      'youtube:player_client=visionos',
      '-f',
      '140',
      '-j',
      `https://music.youtube.com/watch?v=${ID}`,
    ]);
    expect(f.calls.flat().some((a) => /cookie/i.test(a))).toBe(false);
  });
});

describe('the yt-dlp binary', () => {
  // Live in the image 2026-11-03: uid 1000 has no home there, so yt-dlp could not create its cache
  // ("Permission denied: '/.cache'"); its temporary files and cache live in the data volume.
  it('runs with its temp and cache directories in the data volume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-ytdlp-'));
    const bin = join(dir, 'fake-yt-dlp');
    writeFileSync(
      bin,
      '#!/bin/sh\necho "{\\"url\\":\\"https://x/v?expire=1&t=$TMPDIR&c=$XDG_CACHE_HOME\\",\\"filesize\\":5}"\n',
      { mode: 0o755 },
    );
    const r = createYtdlpResolver({
      bin,
      now: () => 0,
      log: () => {},
      tmp: '/data/tmp',
      cache: '/data/cache',
    });
    const got = await r.resolve(ID);
    expect(new URL(got.url).searchParams.get('t')).toBe('/data/tmp');
    expect(new URL(got.url).searchParams.get('c')).toBe('/data/cache');
  });

  it('ensureBinary copies once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-ytdlp-'));
    const bundled = join(dir, 'bundled');
    writeFileSync(bundled, 'v1');
    const bin = ensureBinary(bundled, join(dir, 'data'));
    expect(bin).toBe(join(dir, 'data', 'bin', 'yt-dlp'));
    expect(statSync(bin).mode & 0o777).toBe(0o755);
    writeFileSync(bin, 'self-updated');
    writeFileSync(bundled, 'v2');
    ensureBinary(bundled, join(dir, 'data'));
    expect(existsSync(bin)).toBe(true);
    expect(statSync(bin).size).toBe('self-updated'.length);
  });

  it('records the version after an update, and the error when it fails', async () => {
    const r = createYtdlpResolver({
      bin: 'yt-dlp',
      now: () => 42,
      log: () => {},
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
    });
    await updateYtdlp(
      'yt-dlp',
      r,
      async (_b, args) =>
        args[0] === '--version'
          ? { code: 0, stdout: '2026.10.21\n', stderr: '' }
          : { code: 0, stdout: 'yt-dlp is up to date', stderr: '' },
      () => 42,
    );
    expect(r.status()).toEqual({ version: '2026.10.21', updatedAt: 42, lastError: null });
    await updateYtdlp('yt-dlp', r, async (_b, args) =>
      args[0] === '--version'
        ? { code: 0, stdout: '2026.10.21\n', stderr: '' }
        : { code: 1, stdout: '', stderr: 'ERROR: Unable to write to /data/bin' },
    );
    expect(r.status().lastError).toContain('Unable to write');
    expect(r.status().version).toBe('2026.10.21');
  });
});
