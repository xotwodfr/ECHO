import type { PlayContext, Track } from '../../shared/types.ts';
import type { Library } from '../library.ts';
import type { PlaybackController } from '../playback/controller.ts';
import { upcoming } from '../playback/queue.ts';
import { strings } from '../strings.ts';
import { toastStore } from '../ui/logic.ts';

// Song radio, Autoplay and Smart Shuffle (Spotify's): songs like this one, from Navidrome's similar
// songs (Last.fm) or, without them, random songs.

const RADIO_SIZE = 50;

export async function startRadio(c: PlaybackController, library: Library, seed: Track) {
  try {
    const similar = (await library.similarSongs?.(seed, RADIO_SIZE)) ?? [];
    c.playList([seed, ...similar.filter((t) => t.id !== seed.id)], 0, {
      kind: 'radio',
      id: seed.id,
      title: strings.radio.title(seed.title),
    });
  } catch {
    toastStore.getState().show(strings.radio.failed);
  }
}

/**
 * When the queue runs out (the last track ended, nothing after it, repeat off) and Autoplay is on,
 * similar songs to the last one start, as a radio.
 */
export function startAutoplay(c: PlaybackController, library: Library | null, on: () => boolean) {
  if (!library?.similarSongs) return () => undefined;
  return c.player.subscribe(async (s, prev) => {
    if (s.status !== 'ended' || prev.status === 'ended' || !on()) return;
    const last = s.track;
    if (last?.provider !== 'navidrome' || s.repeat !== 'off') return;
    if (upcoming(c.queue.getState()).length) return;
    const similar = await library.similarSongs?.(last, RADIO_SIZE).catch(() => []);
    const next = (similar ?? []).filter((t) => t.id !== last.id);
    // Something else started meanwhile: leave it.
    if (!next.length || c.player.getState().status !== 'ended') return;
    toastStore.getState().show(strings.radio.autoplay);
    c.playList(next, 0, { kind: 'radio', id: last.id, title: strings.radio.title(last.title) });
  });
}

const SMART_EVERY = 3; // one recommendation after every three of the list's own songs
const SMART_SEEDS = 4;

/**
 * Smart Shuffle: the list shuffled, with songs like a few of its own mixed in. Without similar
 * songs it is a plain shuffle.
 */
export async function startSmartShuffle(
  c: PlaybackController,
  library: Library | null,
  tracks: Track[],
  context: PlayContext,
) {
  const order = [...tracks];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j] as Track, order[i] as Track];
  }
  const own = new Set(tracks.map((t) => t.id));
  const lists = await Promise.all(
    order
      .slice(0, SMART_SEEDS)
      .map((t) => library?.similarSongs?.(t, 10).catch(() => []) ?? Promise.resolve([])),
  );
  const recs = [...new Map(lists.flat().map((t) => [t.id, t])).values()].filter(
    (t) => !own.has(t.id),
  );
  const out: Track[] = [];
  let r = 0;
  order.forEach((t, i) => {
    out.push(t);
    const next = recs[r];
    if (i % SMART_EVERY === SMART_EVERY - 1 && next) {
      out.push(next);
      r++;
    }
  });
  c.playList(out, 0, context);
  toastStore.getState().show(strings.radio.smartAdded(r));
}
