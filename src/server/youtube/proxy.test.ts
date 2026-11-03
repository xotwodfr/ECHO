import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { byteWindow, CHUNK, proxyImage, streamAudio } from './proxy.ts';
import { type Resolved, type Resolver, YtAudioError } from './ytdlp.ts';

// The audio proxy (spec constraints): googlevideo refuses a Range header but serves `&range=a-b`,
// so ECHO turns the browser's Range into that, at most 10 MiB at a time, and answers 206 itself.

const ID = 'fJ9rUzIMcZQ';
const UP = 'https://rr1---sn-x.googlevideo.com/videoplayback?expire=1793752364&itag=140';

function resolver(size: number, fail?: YtAudioError, extra: Partial<Resolved> = {}) {
  const calls: string[] = [];
  const forgotten: string[] = [];
  const r: Resolver = {
    async resolve(id) {
      calls.push(id);
      if (fail) throw fail;
      return {
        url: UP,
        size,
        expiresAt: 0,
        headers: {},
        availableAt: 0,
        ...extra,
      } satisfies Resolved;
    },
    forget: (id) => void forgotten.push(id),
    status: () => ({ version: null, updatedAt: null, lastError: null }),
    note: () => {},
  };
  return { r, calls, forgotten };
}

function upstream(statuses: number[] = [200], type = 'audio/mp4') {
  const seen: { url: string; headers: Headers }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? 'bytes' : 'no', {
      status,
      headers: { 'content-type': type },
    });
  }) as typeof fetch;
  return { f, seen };
}

function app(r: Resolver, f: typeof fetch) {
  const a = new Hono();
  a.get('/s/:id', (c) => streamAudio(c, c.req.param('id'), r, f));
  a.get('/i', (c) => proxyImage(c, c.req.query('u') ?? '', f));
  return a;
}

describe('the byte window', () => {
  it('starts at 0 without a Range, and is capped at one chunk', () => {
    expect(byteWindow(undefined, 1000)).toEqual({ start: 0, end: 999 });
    expect(byteWindow(undefined, 3 * CHUNK)).toEqual({ start: 0, end: CHUNK - 1 });
  });
  it('honours open, closed and suffix ranges', () => {
    expect(byteWindow('bytes=100-', 1000)).toEqual({ start: 100, end: 999 });
    expect(byteWindow('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(byteWindow('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });
  it('is null past the end', () => {
    expect(byteWindow('bytes=1000-', 1000)).toBeNull();
  });
});

describe('the audio proxy', () => {
  it('caps each upstream range', async () => {
    const size = 60_485_760;
    const { r } = resolver(size);
    const u = upstream();
    const res = await app(r, u.f).request(`/s/${ID}`, { headers: { range: 'bytes=50000000-' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 50000000-60485759/${size}`);
    expect(res.headers.get('content-length')).toBe(String(60_485_760 - 50_000_000));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(u.seen[0]?.url).toBe(`${UP}&range=50000000-60485759`);
    expect(u.seen[0]?.headers.has('range')).toBe(false);
  });

  it("sends yt-dlp's headers and waits until the URL is usable", async () => {
    const availableAt = Date.now() + 60;
    const { r } = resolver(1000, undefined, {
      headers: { 'User-Agent': 'UA-of-yt-dlp' },
      availableAt,
    });
    let at = 0;
    const u = upstream();
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      at = Date.now();
      return u.f(input, init);
    }) as typeof fetch;
    const res = await app(r, f).request(`/s/${ID}`);
    expect(res.status).toBe(206);
    expect(u.seen[0]?.headers.get('user-agent')).toBe('UA-of-yt-dlp');
    expect(at).toBeGreaterThanOrEqual(availableAt);
  });

  it('re-resolves once on upstream 403', async () => {
    const { r, calls, forgotten } = resolver(1000);
    const res = await app(r, upstream([403, 200]).f).request(`/s/${ID}`);
    expect(res.status).toBe(206);
    expect(calls).toHaveLength(2);
    expect(forgotten).toEqual([ID]);
    const again = await app(resolver(1000).r, upstream([403, 403]).f).request(`/s/${ID}`);
    expect(again.status).toBe(502);
  });

  it("answers 502 with the resolver's code", async () => {
    const { r } = resolver(0, new YtAudioError('youtube.bot_check', 'Sign in to confirm'));
    const res = await app(r, upstream().f).request(`/s/${ID}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'youtube.bot_check' });
  });

  it('answers 416 past the end', async () => {
    const res = await app(resolver(1000).r, upstream().f).request(`/s/${ID}`, {
      headers: { range: 'bytes=5000-' },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */1000');
  });

  it('serves media only, sandboxed', async () => {
    const res = await app(resolver(1000).r, upstream([200], 'text/html').f).request(`/s/${ID}`);
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    const wav = await app(resolver(1000).r, upstream([200], 'audio/wav').f).request(`/s/${ID}`);
    expect(wav.headers.get('content-type')).toBe('audio/wav'); // the mock's (E2E)
  });
});

describe('the image proxy', () => {
  const u = (url: string) => `/i?u=${encodeURIComponent(url)}`;

  it('refuses image hosts off the list', async () => {
    const up = upstream([200], 'image/jpeg');
    for (const bad of [
      'http://lh3.googleusercontent.com/a=w544',
      'https://evil.example/x.jpg',
      'https://lh3.googleusercontent.com.evil.example/x',
      'https://user@lh3.googleusercontent.com/x',
      'not a url',
    ])
      expect((await app(resolver(1).r, up.f).request(u(bad))).status, bad).toBe(400);
    expect(up.seen).toHaveLength(0);
  });

  it('passes raster images only', async () => {
    const ok = await app(resolver(1).r, upstream([200], 'image/jpeg').f).request(
      u('https://lh3.googleusercontent.com/a=w544-h544'),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, max-age=604800');
    const html = await app(resolver(1).r, upstream([200], 'text/html').f).request(
      u('https://i.ytimg.com/vi/x/hqdefault.jpg'),
    );
    expect(html.status).toBe(502);
  });
});

describe('the mock googlevideo (E2E)', () => {
  it('refuses a Range header and serves the range parameter', async () => {
    const { startMockSubsonic, YT_AUDIO_BYTES } = await import('../navidrome/mock.ts');
    const mock = await startMockSubsonic();
    try {
      const url = `${mock.url}/videoplayback?id=${ID}`;
      expect((await fetch(url, { headers: { range: 'bytes=0-9' } })).status).toBe(403);
      const part = await fetch(`${url}&range=0-9`);
      expect(part.status).toBe(200);
      expect((await part.arrayBuffer()).byteLength).toBe(10);
      const all = await fetch(`${url}&range=0-${YT_AUDIO_BYTES - 1}`);
      expect((await all.arrayBuffer()).byteLength).toBe(YT_AUDIO_BYTES);
    } finally {
      await mock.close();
    }
  });
});
