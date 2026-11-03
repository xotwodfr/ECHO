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
const HINT_FOR_MS = 3_600_000; // a looked-up URL is good for hours; ask again after one

/**
 * Songs about to be pressed (pointed at, focused, first on a page), looked up ahead: a cold
 * YouTube song takes ~9 s (yt-dlp, then YouTube's own wait), a prepared one starts at once. Hints
 * within `waitMs` go as one request of the latest three; the server drops them past a backlog.
 */
export function createHinter(
  send: (ids: string[]) => Promise<unknown> = ytPrepare,
  waitMs = 150,
  now: () => number = Date.now,
) {
  const asked = new Map<string, number>();
  let batch: string[] = [];
  let waiting = false;
  return (id: string) => {
    const at = asked.get(id);
    if ((at !== undefined && now() - at < HINT_FOR_MS) || batch.includes(id)) return;
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
