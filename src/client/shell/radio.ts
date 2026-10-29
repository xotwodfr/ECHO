import type { Track } from '../../shared/types.ts';
import type { Library } from '../library.ts';
import type { PlaybackController } from '../playback/controller.ts';
import { upcoming } from '../playback/queue.ts';
import { strings } from '../strings.ts';
import { toastStore } from '../ui/logic.ts';

// Song radio and Autoplay (Spotify's): songs like this one, from Navidrome's similar songs (Last.fm)
// or, without them, random songs.

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
