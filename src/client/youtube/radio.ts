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
