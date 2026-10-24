// Spotify covers for gate G1 (VISUALIZER_SPEC.md §6.1; PLAYBACK_ARCHITECTURE.md §4.6): only
// https://i.scdn.co images, fetched into memory, decoded and dropped. Nothing of the image is
// written to disk (SP-03); only the derived palette is cached.

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = /^image\/(jpeg|png|webp)$/;

/** The validated cover URL, or null: https, host i.scdn.co, default port, no credentials. */
export function spotifyArt(raw: string | undefined): string | null {
  if (!raw || raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'i.scdn.co' || u.port || u.username || u.password)
    return null;
  return `https://i.scdn.co${u.pathname}`;
}

/** Fetches the cover from `base` (i.scdn.co, or a mock in E2E) by the validated URL's path. */
export async function fetchSpotifyCover(
  art: string,
  base: string,
  f: typeof fetch = fetch,
): Promise<Buffer | null> {
  try {
    const res = await f(`${base}${new URL(art).pathname}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok || !TYPES.test(res.headers.get('content-type') ?? '')) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > MAX_BYTES ? null : buf;
  } catch {
    return null;
  }
}
