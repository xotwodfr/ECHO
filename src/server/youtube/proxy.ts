import type { Context } from 'hono';
import { type Resolved, type Resolver, YtAudioError } from './ytdlp.ts';

// The audio and image proxies for YouTube Music mode. Audio: the URL yt-dlp resolved is bound to
// this server's IP, so the bytes come through ECHO; googlevideo answers 403 to a Range header but
// serves the `range` query parameter, so the browser's Range becomes that, one chunk at a time
// (googlevideo throttles bigger requests), and ECHO answers 206 itself. Images: the CSP keeps
// `img-src 'self'`, so thumbnails come through here too, from YouTube's image hosts only.

export const CHUNK = 10_485_760;
export const IMAGE_HOSTS = [
  'lh3.googleusercontent.com',
  'yt3.ggpht.com',
  'yt3.googleusercontent.com',
  'i.ytimg.com',
] as const;
const AUDIO = /^audio\/(mp4|webm|wav|mpeg)$/;
const RASTER = /^image\/(jpeg|png|webp|gif|avif)$/;

/**
 * The bytes to fetch for a browser's Range header (absent or malformed: from 0), at most one
 * chunk. Null when it starts past the end (416).
 */
export function byteWindow(
  range: string | undefined,
  size: number,
): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range?.trim() ?? '');
  let start = 0;
  let end = size - 1;
  if (m?.[1]) {
    start = Number(m[1]);
    if (m[2]) end = Math.min(end, Number(m[2]));
  } else if (m?.[2]) start = Math.max(0, size - Number(m[2])); // the last n bytes
  if (start >= size || end < start) return null;
  return { start, end: Math.min(end, start + CHUNK - 1) };
}

const problem = (c: Context, code: string, status: 502) =>
  c.json({ code, userMessage: 'This song can’t play from YouTube.' }, status);

export async function streamAudio(
  c: Context,
  videoId: string,
  r: Resolver,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let got: Resolved;
    try {
      got = await r.resolve(videoId);
    } catch (err) {
      return problem(c, err instanceof YtAudioError ? err.code : 'youtube.failed', 502);
    }
    const w = byteWindow(c.req.header('range'), got.size);
    if (!w) return c.body(null, 416, { 'content-range': `bytes */${got.size}` });
    // A fresh URL is refused for a few seconds (yt-dlp sleeps for it too).
    const wait = got.availableAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    let up: Response;
    try {
      up = await fetchImpl(`${got.url}&range=${w.start}-${w.end}`, {
        headers: got.headers,
        redirect: 'follow',
        signal: c.req.raw.signal, // the browser gave up (a seek, Next): so does the upstream
      });
    } catch {
      return problem(c, 'youtube.failed', 502);
    }
    // Expired early or moved: resolve again, once.
    if (up.status === 403 && attempt === 0) {
      await up.body?.cancel();
      r.forget(videoId);
      continue;
    }
    if (!up.ok || !up.body) {
      await up.body?.cancel();
      return problem(c, 'youtube.failed', 502);
    }
    const type = up.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    return new Response(up.body, {
      status: 206,
      headers: {
        'content-type': AUDIO.test(type) ? type : 'audio/mp4',
        'content-length': String(w.end - w.start + 1),
        'content-range': `bytes ${w.start}-${w.end}/${got.size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'private, no-store',
        'content-security-policy': "sandbox; default-src 'none'",
      },
    });
  }
  return problem(c, 'youtube.failed', 502);
}

export async function proxyImage(
  c: Context,
  u: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return c.json({ error: 'bad_image' }, 400);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(IMAGE_HOSTS as readonly string[]).includes(url.hostname)
  )
    return c.json({ error: 'bad_image' }, 400);
  let up: Response;
  try {
    // No redirects: a redirect could lead off the allowed hosts.
    up = await fetchImpl(url.href, { redirect: 'error', signal: c.req.raw.signal });
  } catch {
    return c.json({ error: 'image_failed' }, 502);
  }
  const type = up.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!up.ok || !up.body || !RASTER.test(type)) {
    await up.body?.cancel();
    return c.json({ error: 'image_failed' }, 502);
  }
  return new Response(up.body, {
    headers: {
      'content-type': type,
      'cache-control': 'private, max-age=604800',
      'content-security-policy': "sandbox; default-src 'none'",
    },
  });
}
