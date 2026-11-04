import type { Track } from '../../shared/types.ts';
import type { YtUpNext } from '../../shared/youtube.ts';
import type { PlaybackController } from '../playback/controller.ts';
import { upcoming } from '../playback/queue.ts';
import { strings } from '../strings.ts';
import { toastStore } from '../ui/logic.ts';
import { ytPrepare, ytUpNext } from './api.ts';

// YouTube Music's radio when the queue runs out (spec call 11), and the next few songs resolved
// ahead (goal 9): yt-dlp takes seconds per song, so the next one is fetched while this one plays.

const PREPARE = 3;
const PAGE_AHEAD = 6; // a page's first songs, looked up as it opens
const HINT_FOR_MS = 3_600_000; // a looked-up URL is good for hours; ask again after one

/**
 * Songs about to be pressed, looked up ahead: a cold YouTube song takes ~2 s (yt-dlp), a prepared
 * one starts at once. Pointed at or focused: hints within `waitMs` go as one request of the latest
 * three. `page`: a page's first six songs as it opens, one request in page order. Each song once
 * an hour; the server drops look-ups past a backlog.
 */
export function createHinter(
  send: (ids: string[]) => Promise<unknown> = ytPrepare,
  waitMs = 150,
  now: () => number = Date.now,
) {
  const asked = new Map<string, number>();
  const fresh = (id: string) => {
    const at = asked.get(id);
    return at === undefined || now() - at >= HINT_FOR_MS;
  };
  let batch: string[] = [];
  let waiting = false;
  const hint = (id: string) => {
    if (!fresh(id) || batch.includes(id)) return;
    batch.push(id);
    if (waiting) return;
    waiting = true;
    setTimeout(() => {
      const ids = batch.slice(-PREPARE);
      batch = [];
      waiting = false;
      for (const x of ids) asked.set(x, now());
      void send(ids).catch(() => undefined);
    }, waitMs);
  };
  const page = (ids: string[]) => {
    const todo = ids.slice(0, PAGE_AHEAD).filter(fresh);
    if (!todo.length) return;
    for (const x of todo) asked.set(x, now());
    void send(todo).catch(() => undefined);
  };
  return Object.assign(hint, { page });
}

export const hintSong = createHinter();

/** On every queue change: the playing and next two YouTube songs, resolved ahead (once per set). */
export function startYtPrepare(
  c: PlaybackController,
  prepare: (ids: string[]) => Promise<unknown> = ytPrepare,
) {
  let last = '';
  return c.queue.subscribe((q) => {
    // The song now playing first: its stream's own resolve shares the job (the server dedupes).
    const ids = [...(q.now ? [q.now] : []), ...upcoming(q)]
      .filter((t) => t.provider === 'youtube')
      .slice(0, PREPARE)
      .map((t) => t.id);
    const key = ids.join(',');
    if (!ids.length || key === last) return;
    last = key;
    void prepare(ids).catch(() => undefined);
  });
}

/** The queue ended on a YouTube song: its Up next follows, without what was just heard. */
export async function ytAutoplay(
  c: PlaybackController,
  last: Track,
  upNext: (id: string) => Promise<YtUpNext> = ytUpNext,
) {
  if (last.provider !== 'youtube') return;
  const heard = new Set([last.id, ...c.queue.getState().history.map((t) => t.id)]);
  const next = await upNext(last.id).then(
    (r) => r.tracks.filter((t) => !heard.has(t.id)),
    () => [],
  );
  // Something else started meanwhile: leave it.
  if (!next.length || c.player.getState().status !== 'ended') return;
  toastStore.getState().show(strings.radio.autoplay);
  c.playList(next, 0, { kind: 'radio', id: last.id, title: strings.radio.title(last.title) });
}
