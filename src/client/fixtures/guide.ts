import type { Track } from '../../shared/types.ts';
import { lyricFixtures } from './lyrics.ts';

// The "Guide Tones" fixture album: one track per lyric fixture, played as guide-tone audio with a
// paired Features track (`feature-tracks.ts`). Development builds only.

export const GUIDE_ALBUM_ID = 'al-guide';
export const guideNames = Object.keys(lyricFixtures);

/** The Features track each lyric fixture plays with. */
export const guideFeatures: Record<string, string> = {
  'ballad-word': 'ballad',
  'rap-word': 'techno',
  'duet-word': 'pop',
  'pop-line': 'pop',
  static: 'silence',
  'cjk-word': 'ballad',
  'rtl-line': 'pop',
  'accents-word': 'ballad',
  'long-lines': 'pop',
  'intro-outro': 'ballad',
};

/** The lyric fixture a library track plays, if it is a guide track (`al-guide-<n>`). */
export function guideFixtureOf(track: Track): string | undefined {
  if (track.album.id !== GUIDE_ALBUM_ID) return undefined;
  return guideNames[Number(track.id.slice(GUIDE_ALBUM_ID.length + 1)) - 1];
}
