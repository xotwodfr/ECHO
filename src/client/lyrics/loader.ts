import type { LyricsDoc, Track } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import type { PlaybackController } from '../playback/controller.ts';
import { upcoming } from '../playback/queue.ts';
import { lyricOffset, lyricsStore } from '../stage/status.ts';

// The lyrics loader (LYRICS_INTEGRATION.md §6; LYRICS_EXPERIENCE.md §9.5, §9.13): follows the
// current track, asks the server 250 ms after a change (rapid skips cost nothing), drops answers for
// any track but the current one, gives up at 6 s (Cover mode) while still accepting a late answer,
// and warms the server's cache for the next track. The user's offset (`[`/`]`, ±50 ms) and source
// pin are saved per track.

export const DEBOUNCE_MS = 250;
export const GIVE_UP_MS = 6000;
const PREFETCH_MS = 2000;
const SAVE_OFFSET_MS = 500;
export const OFFSET_STEP_MS = 50;

type Answer = {
  doc: LyricsDoc | null;
  tried: { source: string; outcome: string }[];
  offsetMs: number;
  pinnedSource: string | null;
};

export function lyricsQuery(t: Track) {
  const q = new URLSearchParams({
    trackKey: t.key,
    title: t.title,
    artist: t.artists[0]?.name ?? '',
    album: t.album.title,
    durationMs: String(t.durationMs),
  });
  // Lets the server find a Spotify id for Spicy Lyrics (LYRICS_INTEGRATION.md §4.3).
  if (t.isrc) q.set('isrc', t.isrc);
  return `/lyrics?${q}`;
}

export async function fetchLyrics(t: Track): Promise<Answer> {
  try {
    const r = await api<{
      doc: LyricsDoc;
      override: { offsetMs: number; pinnedSource: string | null };
    }>(lyricsQuery(t));
    return { doc: r.doc, tried: [], ...r.override };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      const b = err.body as {
        tried?: Answer['tried'];
        override?: { offsetMs: number; pinnedSource: string | null };
      };
      return {
        doc: null,
        tried: b.tried ?? [],
        offsetMs: b.override?.offsetMs ?? 0,
        pinnedSource: b.override?.pinnedSource ?? null,
      };
    }
    return { doc: null, tried: [], offsetMs: 0, pinnedSource: null };
  }
}

let current: { track: Track | null; reload: () => void } = { track: null, reload: () => {} };
let notify: (m: string) => void = () => {};
/** Pending offset saves, one per track: a save for one track never cancels another's. */
const saves = new Map<string, ReturnType<typeof setTimeout>>();

export function startLyricsLoader(
  c: PlaybackController,
  toast: (message: string) => void,
  load: (t: Track) => Promise<Answer> = fetchLyrics,
) {
  notify = toast;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let giveUp: ReturnType<typeof setTimeout> | null = null;
  let prefetch: ReturnType<typeof setTimeout> | null = null;

  const start = (track: Track | null) => {
    for (const t of [debounce, giveUp, prefetch]) if (t) clearTimeout(t);
    current = { track, reload: () => start(track) };
    // The offset and pin are the track's own: none until its answer brings them.
    const none = { doc: null, tried: [], offsetMs: 0, pinnedSource: null };
    if (!track) {
      lyricsStore.setState({ trackKey: null, state: 'idle', ...none });
      return;
    }
    lyricsStore.setState({
      trackKey: track.key,
      state: 'waiting',
      since: performance.now(),
      ...none,
    });
    debounce = setTimeout(() => {
      void load(track).then((a) => {
        // A late answer for a track that is no longer playing is dropped (the server cached it).
        if (lyricsStore.getState().trackKey !== track.key) return;
        if (giveUp) clearTimeout(giveUp);
        lyricsStore.setState({
          doc: a.doc,
          state: a.doc ? 'ready' : 'missing',
          tried: a.tried,
          offsetMs: a.offsetMs,
          pinnedSource: a.pinnedSource,
        });
      });
    }, DEBOUNCE_MS);
    giveUp = setTimeout(() => {
      if (
        lyricsStore.getState().trackKey === track.key &&
        lyricsStore.getState().state === 'waiting'
      )
        lyricsStore.setState({ state: 'missing' });
    }, GIVE_UP_MS);
    // The next track's lyrics, in the background, so its own request is a cache hit.
    prefetch = setTimeout(() => {
      const next = upcoming(c.queue.getState())[0];
      if (next && track.durationMs - PREFETCH_MS >= 20_000)
        void api(lyricsQuery(next)).catch(() => undefined);
    }, PREFETCH_MS);
  };

  c.player.subscribe((s, prev) => s.track?.key !== prev.track?.key && start(s.track));
  start(c.player.getState().track);
}

/** `[` / `]`: the lyrics ±50 ms for this track, saved, with a toast (LYR-25). */
export function nudgeLyrics(direction: -1 | 1) {
  const s = lyricsStore.getState();
  // Until the track's answer arrives its saved offset is unknown: a nudge would overwrite it.
  if (!s.trackKey || s.state === 'waiting') return;
  const offsetMs = Math.max(-10_000, Math.min(10_000, s.offsetMs + direction * OFFSET_STEP_MS));
  lyricsStore.setState({ offsetMs });
  // The toast shows the total, the global offset included (LYRICS_EXPERIENCE.md §9.13).
  const total = lyricOffset();
  notify(total === 0 ? 'Lyrics on time' : `Lyrics ${total > 0 ? '+' : '−'}${Math.abs(total)} ms`);
  const key = s.trackKey;
  clearTimeout(saves.get(key));
  saves.set(
    key,
    setTimeout(() => {
      saves.delete(key);
      void api(`/me/tracks/${encodeURIComponent(key)}/override`, {
        method: 'PUT',
        body: { offsetMs },
      }).catch(() => undefined);
    }, SAVE_OFFSET_MS),
  );
}

/** The ⓘ menu: always use this source for the track (null: automatic), then reload. */
export async function pinLyricsSource(source: string | null) {
  const key = lyricsStore.getState().trackKey;
  if (!key) return;
  await api(`/me/tracks/${encodeURIComponent(key)}/override`, {
    method: 'PUT',
    body: { pinnedSource: source },
  }).catch(() => undefined);
  current.reload();
}

/**
 * No lyrics because there are no words: a source flagged it, or the title says "instrumental"
 * (LYRICS_EXPERIENCE.md §9.4: the cover, with no message).
 */
export const isInstrumental = (title: string | undefined, tried: { outcome: string }[]) =>
  tried.some((t) => t.outcome === 'instrumental') || /\binstrumental\b/i.test(title ?? '');

/** The line being sung at `ms` (the scrubber's preview, PLAY-10). */
export function lineAt(doc: LyricsDoc | null, ms: number) {
  if (!doc || doc.sync === 'none') return null;
  let line: string | null = null;
  for (const l of doc.lines) {
    if (l.start > ms) break;
    line = l.text || null;
  }
  return line;
}
