import type { Track } from '../../shared/types.ts';
import type { YtItem, YtUpNext } from '../../shared/youtube.ts';
import type { PlaybackController } from '../playback/controller.ts';
import { strings } from '../strings.ts';
import { toastStore } from '../ui/logic.ts';
import { ytUpNext } from './api.ts';

// What a tap plays in YouTube Music mode (spec call 15), as YouTube Music does: a single song (in
// search, a shelf, Related) starts its radio, Up next filled with YouTube's automix; a song
// in an album, a playlist or Liked music plays that list from there.

export async function playItem(
  c: PlaybackController,
  item: YtItem,
  list?: { tracks: Track[]; kind: 'album' | 'playlist' | 'artist'; id: string; title: string },
  upNext: (id: string) => Promise<YtUpNext> = ytUpNext,
) {
  const track = item.track;
  if (!track) return;
  if (list) {
    const index = Math.max(
      0,
      list.tracks.findIndex((t) => t.id === track.id),
    );
    return c.playList(list.tracks, index, { kind: list.kind, id: list.id, title: list.title });
  }
  // Up next answers in about half a second, well inside the audio's own start-up (yt-dlp).
  const radio = { kind: 'radio', id: track.id, title: strings.radio.title(track.title) } as const;
  try {
    const { tracks } = await upNext(track.id);
    // Up next's copy of the song first: a search row's may lack its duration.
    const seed = tracks.find((t) => t.id === track.id) ?? track;
    c.playList([seed, ...tracks.filter((t) => t.id !== track.id)], 0, radio);
  } catch {
    c.playList([track], 0, radio);
    toastStore.getState().show(strings.radio.failed);
  }
}
