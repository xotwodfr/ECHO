import type { LyricsDoc, Track } from '../../shared/types.ts';
import { GUIDE_ALBUM_ID, guideFixtureOf, guideNames } from './guide.ts';
import { lyricFixtures } from './lyrics.ts';
import { FixtureProvider } from './provider.ts';

// Everything the fixture build adds, behind one dynamic import so the image leaves it out.
export { loadFeatureFixture } from './features.ts';
export { fixtureLibrary } from './library.ts';

/** The guide track of a lyric fixture (`?fixture=ballad-word` cues it), if there is one. */
export const guideTrackId = (fixture: string) =>
  guideNames.includes(fixture) ? `${GUIDE_ALBUM_ID}-${guideNames.indexOf(fixture) + 1}` : undefined;
export const createFixtureProvider = () => new FixtureProvider();

/** The fixture document a guide track sings (M3 has no lyrics loader; M6 brings one). */
export const fixtureLyrics = (track: Track | null): LyricsDoc | null =>
  (track && lyricFixtures[guideFixtureOf(track) ?? '']) || null;
