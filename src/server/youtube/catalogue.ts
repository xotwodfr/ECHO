import { Innertube, Log } from 'youtubei.js';
import type { Track } from '../../shared/types.ts';
import type {
  YtItem,
  YtKind,
  YtLyrics,
  YtPage,
  YtShelf,
  YtTab,
  YtUpNext,
} from '../../shared/youtube.ts';
import { VIDEO_ID } from './ytdlp.ts';

// The YouTube Music catalogue (spec call 2): youtubei.js speaks InnerTube, the API the YouTube
// Music website uses (no key, no quota), and this maps its answers into ECHO's shapes
// (src/shared/youtube.ts). A page is shelves of two kinds of item: list rows
// (MusicResponsiveListItem) and cards (MusicTwoRowItem); Up next is PlaylistPanelVideo. Unknown
// renderers are skipped, never thrown on: YouTube changes them often. The cookie, when the user
// saved one, only ever goes to YouTube's own hosts; audio never uses it (ytdlp.ts).

// youtubei.js reports renderers it does not know on the console; the mapping skips them anyway.
Log.setLevel(Log.Level.NONE);

/** The user's cookie is missing, or YouTube no longer accepts it. */
export class YtSignedOut extends Error {}

export interface Catalogue {
  account(): Promise<{ name: string }>;
  home(): Promise<YtPage>;
  explore(): Promise<YtPage>;
  library(): Promise<YtPage>;
  search(q: string, tab: YtTab): Promise<YtPage>;
  suggest(q: string): Promise<string[]>;
  album(id: string): Promise<YtPage>;
  artist(id: string): Promise<YtPage>;
  playlist(id: string): Promise<YtPage>;
  upNext(videoId: string): Promise<YtUpNext>;
  related(videoId: string): Promise<YtPage>;
  lyrics(videoId: string): Promise<YtLyrics | null>;
  like(videoId: string, on: boolean): Promise<void>;
  /** Whether the user likes the song (false when signed out). */
  liked(videoId: string): Promise<boolean>;
  played(videoId: string): Promise<void>;
}

// ---- what the mapping reads of youtubei.js's nodes --------------------------------------------

interface Text {
  toString(): string;
}
interface Thumb {
  url: string;
  width?: number;
}
interface Person {
  name: string;
  channel_id?: string;
}
interface Payload {
  videoId?: string;
  browseId?: string;
}
/** A youtubei.js node, as far as this file reads one. */
interface Raw {
  type?: string;
  item_type?: string;
  id?: string;
  video_id?: string;
  title?: string | Text;
  name?: string;
  subtitle?: Text;
  second_subtitle?: Text;
  strapline_text_one?: Text;
  strapline?: Text;
  description?: Text | { description?: Text };
  footer?: Text;
  artists?: Person[];
  authors?: Person[];
  author?: Person;
  album?: { id?: string; name?: string };
  duration?: { seconds?: number };
  thumbnail?: Thumb[] | { contents?: Thumb[] };
  thumbnails?: Thumb[];
  endpoint?: { payload?: Payload };
  header?: Raw;
  contents?: Raw[];
  sections?: Raw[];
  items?: Raw[];
  suggestion?: Text;
}

const IMAGE = '/api/v1/youtube/image?u=';
const text = (t: string | Text | undefined | null) => (t == null ? '' : String(t)).trim();
/** lh3/yt3 sizes are in the URL (`=w60-h60-…`): ask for one big enough for every view. */
const bigger = (u: string) => u.replace(/=w\d+-h\d+[^/]*$/, '=w544-h544-l90-rj');

export function thumbOf(n: Raw | undefined): string {
  const t = n?.thumbnail;
  const list = Array.isArray(t) ? t : (t?.contents ?? n?.thumbnails ?? []);
  const best = [...list].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return best?.url ? IMAGE + encodeURIComponent(bigger(best.url)) : '';
}

export function ytTrack(p: {
  id: string;
  title: string;
  artists: { id?: string; name: string }[];
  album?: { id?: string; title: string };
  durationMs: number;
  thumb: string;
}): Track {
  return {
    key: `youtube:${p.id}`,
    provider: 'youtube',
    id: p.id,
    title: p.title,
    artists: p.artists,
    album: {
      ...(p.album?.id && { id: p.album.id }),
      title: p.album?.title ?? '',
      key: `youtube:${p.album?.id ?? p.id}`,
    },
    durationMs: p.durationMs,
    artwork: p.thumb ? [{ url: p.thumb }] : [],
  };
}

const people = (n: Raw) =>
  (n.artists?.length ? n.artists : n.authors?.length ? n.authors : n.author ? [n.author] : []).map(
    (a) => ({ ...(a.channel_id && { id: a.channel_id }), name: a.name }),
  );

interface Fallback {
  album?: { id?: string; title: string };
  artists?: { id?: string; name: string }[];
  thumb?: string;
}

function trackOf(n: Raw, fb: Fallback = {}): Track | undefined {
  const id = n.video_id ?? n.endpoint?.payload?.videoId ?? n.id;
  if (!id || !VIDEO_ID.test(id)) return undefined;
  const artists = people(n);
  return ytTrack({
    id,
    title: text(n.title ?? n.name),
    artists: artists.length ? artists : (fb.artists ?? []),
    ...((n.album?.name || fb.album) && {
      album: n.album?.name
        ? { ...(n.album.id && { id: n.album.id }), title: n.album.name }
        : fb.album,
    }),
    durationMs: (n.duration?.seconds ?? 0) * 1000,
    thumb: thumbOf(n) || fb.thumb || '',
  });
}

const KINDS: readonly YtKind[] = ['song', 'video', 'album', 'playlist', 'artist'];

function itemOf(n: Raw): YtItem | undefined {
  const kind = KINDS.find((k) => k === n.item_type);
  if (!kind) return undefined;
  const playable = kind === 'song' || kind === 'video';
  const id = playable
    ? (n.endpoint?.payload?.videoId ?? n.video_id ?? n.id)
    : (n.endpoint?.payload?.browseId ?? n.id);
  if (!id) return undefined;
  const track = playable ? trackOf(n) : undefined;
  if (playable && !track) return undefined;
  const by = people(n)
    .map((a) => a.name)
    .join(', ');
  return {
    kind,
    id,
    title: text(n.title ?? n.name),
    subtitle: text(n.subtitle) || by,
    thumb: thumbOf(n),
    ...(track && { track }),
  };
}

const isRow = (n: Raw) => n.type === 'MusicResponsiveListItem' || n.type === 'PlaylistPanelVideo';

function shelfOf(sec: Raw): YtShelf | undefined {
  const raw = sec.contents ?? [];
  const items = raw.map(itemOf).filter((i): i is YtItem => !!i);
  if (!items.length) return undefined;
  const strapline = text(sec.header?.strapline);
  return {
    title: text(sec.header?.title ?? sec.title),
    ...(strapline && { strapline }),
    layout: raw.filter(isRow).length * 2 > raw.length ? 'rows' : 'cards',
    items,
  };
}

const shelvesOf = (sections: Raw[] | undefined) =>
  (sections ?? []).map(shelfOf).filter((s): s is YtShelf => !!s);

const GROUPS: { kind: YtKind; title: string; tab: YtTab }[] = [
  { kind: 'song', title: 'Songs', tab: 'songs' },
  { kind: 'video', title: 'Videos', tab: 'all' },
  { kind: 'album', title: 'Albums', tab: 'albums' },
  { kind: 'artist', title: 'Artists', tab: 'artists' },
  { kind: 'playlist', title: 'Playlists', tab: 'playlists' },
];
const SEARCH_TYPE = {
  songs: 'song',
  albums: 'album',
  artists: 'artist',
  playlists: 'playlist',
} as const;

/** Search answers are a flat run of items (one per section, lately): grouped by kind, in order. */
function grouped(sections: Raw[] | undefined, tab: YtTab): YtShelf[] {
  const items = (sections ?? [])
    .flatMap((s) => (s.contents?.length ? s.contents : [s]))
    .map(itemOf)
    .filter((i): i is YtItem => !!i);
  return GROUPS.filter((g) => tab === 'all' || g.tab === tab)
    .map((g) => ({
      title: g.title,
      layout: g.kind === 'song' || g.kind === 'video' ? ('rows' as const) : ('cards' as const),
      items: items.filter((i) => i.kind === g.kind),
    }))
    .filter((s) => s.items.length);
}

/** "You must be signed in", a 401, a login page: all mean the cookie is missing or stale. */
const SIGNED_OUT = /signed in|sign in|log ?in|LOGIN_REQUIRED|status code 401/i;

export function createCatalogue(opts: {
  cookie?: string;
  fetch?: typeof fetch;
  lang?: string;
  region?: string;
}): Catalogue {
  // Every InnerTube answer says whether it was answered signed in (`logged_in`). With a cookie, a
  // "0" means Google no longer accepts it (rotated): signed out, on every page, Home included.
  let staleSeen = false;
  const base = opts.fetch ?? fetch;
  const checked: typeof fetch = async (input, init) => {
    const res = await base(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (opts.cookie && res.ok && url.includes('/youtubei/v1/')) {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as {
        responseContext?: {
          serviceTrackingParams?: { params?: { key: string; value: string }[] }[];
        };
      } | null;
      const loggedIn = body?.responseContext?.serviceTrackingParams
        ?.flatMap((p) => p.params ?? [])
        .find((p) => p.key === 'logged_in')?.value;
      if (loggedIn === '0') {
        staleSeen = true;
        throw new YtSignedOut('YouTube answered signed out');
      }
    }
    return res;
  };
  let session: Promise<Innertube> | null = null;
  const yt = () => {
    session ??= Innertube.create({
      retrieve_player: false,
      generate_session_locally: true,
      lang: opts.lang ?? 'en',
      location: opts.region ?? 'SE',
      ...(opts.cookie && { cookie: opts.cookie }),
      fetch: checked,
    }).catch((err: unknown) => {
      session = null; // the next call tries again
      throw err;
    });
    return session;
  };
  const signedIn = () => {
    if (!opts.cookie) throw new YtSignedOut('not signed in');
  };
  /** Runs `fn`, turning a signed-out answer into YtSignedOut. */
  async function call<T>(fn: (y: Innertube) => Promise<T>): Promise<T> {
    staleSeen = false;
    try {
      return await fn(await yt());
    } catch (err) {
      // youtubei.js may wrap what `checked` threw: the flag says it was a signed-out answer.
      if (err instanceof YtSignedOut || staleSeen) throw new YtSignedOut('signed out');
      const e = err as { message?: string; info?: unknown };
      if (SIGNED_OUT.test(`${e.message ?? ''} ${String(e.info ?? '')}`))
        throw new YtSignedOut(e.message ?? 'signed out');
      throw err;
    }
  }
  const raw = <T>(v: T) => v as unknown as Raw;

  return {
    account: () =>
      call(async (y) => {
        signedIn();
        const info = raw(await y.account.getInfo());
        const name = findText(info, 'account_name');
        if (!name) throw new YtSignedOut('no account in the answer');
        return { name };
      }),

    home: () =>
      call(async (y) => ({
        title: 'Home',
        shelves: shelvesOf(raw(await y.music.getHomeFeed()).sections),
      })),

    explore: () =>
      call(async (y) => ({
        title: 'Explore',
        shelves: shelvesOf(raw(await y.music.getExplore()).sections),
      })),

    library: () =>
      call(async (y) => {
        signedIn();
        const lib = raw(await y.music.getLibrary());
        const liked: YtShelf = {
          title: 'Liked music',
          layout: 'cards',
          items: [
            {
              kind: 'playlist',
              id: 'VLLM',
              title: 'Liked music',
              subtitle: 'Auto playlist',
              thumb: '',
            },
          ],
        };
        return { title: 'Library', shelves: [liked, ...shelvesOf(lib.contents ?? lib.sections)] };
      }),

    search: (q, tab) =>
      call(async (y) => {
        const r =
          tab === 'all'
            ? await y.music.search(q)
            : await y.music.search(q, { type: SEARCH_TYPE[tab] });
        return { title: q, shelves: grouped(raw(r).contents, tab) };
      }),

    suggest: (q) =>
      call(async (y) => {
        const sections = (await y.music.getSearchSuggestions(q)) as unknown as Raw[];
        return sections
          .flatMap((s) => s.contents ?? [])
          .map((s) => text(s.suggestion))
          .filter(Boolean)
          .slice(0, 8);
      }),

    album: (id) =>
      call(async (y) => {
        const a = raw(await y.music.getAlbum(id));
        const h = a.header;
        const title = text(h?.title);
        const artist = text(h?.strapline_text_one);
        const thumb = thumbOf(h);
        const fb: Fallback = {
          album: { id, title },
          artists: artist ? [{ name: artist }] : [],
          thumb,
        };
        const tracks = (a.contents ?? []).map((n) => trackOf(n, fb)).filter((t): t is Track => !!t);
        // An album's own tracks are of the album (their rows name none).
        for (const t of tracks) Object.assign(t.album, { id, title, key: `youtube:${id}` });
        return {
          kind: 'album',
          id,
          title,
          subtitle: [text(h?.subtitle), artist, text(h?.second_subtitle)]
            .filter(Boolean)
            .join(' • '),
          description: descriptionOf(h),
          thumb,
          tracks,
          shelves: shelvesOf(a.sections),
        };
      }),

    artist: (id) =>
      call(async (y) => {
        const a = raw(await y.music.getArtist(id));
        const h = a.header;
        const shelves = shelvesOf(a.sections);
        const top = shelves.find((s) => s.layout === 'rows');
        return {
          kind: 'artist',
          id,
          title: text(h?.title),
          description: descriptionOf(h),
          thumb: thumbOf(h),
          tracks: (top?.items ?? []).flatMap((i) => (i.track ? [i.track] : [])),
          shelves,
        };
      }),

    playlist: (id) =>
      call(async (y) => {
        if (id === 'VLLM') signedIn(); // Liked music is the user's own
        const p = raw(await y.music.getPlaylist(id));
        const h = p.header;
        const thumb = thumbOf(h);
        return {
          kind: 'playlist',
          id,
          title: text(h?.title),
          subtitle: [text(h?.subtitle), text(h?.second_subtitle)].filter(Boolean).join(' • '),
          description: descriptionOf(h),
          thumb,
          tracks: (p.items ?? p.contents ?? [])
            .map((n) => trackOf(n, { thumb }))
            .filter((t): t is Track => !!t),
          shelves: [],
        };
      }),

    upNext: (videoId) =>
      call(async (y) => ({
        tracks: (raw(await y.music.getUpNext(videoId, true)).contents ?? [])
          .map((n) => trackOf(n))
          .filter((t): t is Track => !!t),
      })),

    related: (videoId) =>
      call(async (y) => {
        const r = raw(await y.music.getRelated(videoId));
        return { title: 'Related', shelves: shelvesOf(r.contents) };
      }),

    lyrics: (videoId) =>
      call(async (y) => {
        const l = raw(await y.music.getLyrics(videoId).catch(() => undefined));
        const body = text(l?.description as Text | undefined);
        return body ? { text: body, source: text(l?.footer).replace(/^Source:\s*/, '') } : null;
      }),

    like: (videoId, on) =>
      call(async (y) => {
        signedIn();
        await (on ? y.interact.like(videoId) : y.interact.removeRating(videoId));
      }),

    liked: (videoId) =>
      call(async (y) => {
        // The answer Up next reads carries the like button's state (`likeStatus`).
        const r = await y.actions.execute('/next', { videoId, client: 'YTMUSIC' });
        return likeStatusOf(r.data);
      }),

    played: (videoId) =>
      call(async (y) => {
        if (!opts.cookie) return; // anonymous plays go nowhere
        const info = await y.music.getInfo(videoId);
        await info.addToWatchHistory();
      }),
  };
}

/** A `likeStatus` of LIKE anywhere in an answer (the player overlay's like button). */
export function likeStatusOf(n: unknown): boolean {
  return findText(n, 'likeStatus', 0, 12) === 'LIKE';
}

function descriptionOf(h: Raw | undefined): string {
  const d = h?.description;
  if (!d) return '';
  return text((d as { description?: Text }).description ?? (d as Text));
}

/** The first string under `key`, anywhere in a node (account names sit a few levels down). */
function findText(n: unknown, key: string, depth = 0, max = 6): string {
  if (!n || typeof n !== 'object' || depth > max) return '';
  const o = n as Record<string, unknown>;
  if (o[key] != null) return text(o[key] as Text);
  for (const v of Object.values(o)) {
    const hit = findText(v, key, depth + 1, max);
    if (hit) return hit;
  }
  return '';
}
