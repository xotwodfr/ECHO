import type { Track } from '../../shared/types.ts';
import { type Album, createLibrary } from '../library.ts';
import glassWeather from './covers/glass-weather.svg';
import harbourLights from './covers/harbour-lights.svg';
import longExposure from './covers/long-exposure.svg';
import paperSatellites from './covers/paper-satellites.svg';
import signalNoise from './covers/signal-noise.svg';
import { GUIDE_ALBUM_ID, guideNames } from './guide.ts';
import { lyricFixtures } from './lyrics.ts';

// Fixture library (M2 task 3): invented albums, artists and covers drawn for ECHO, so the shell can
// be used without a server. Development builds only: compiled out of the image (ECHO_SPECIMEN=0).

const ms = (m: number, s: number) => (m * 60 + s) * 1000;

function album(
  id: string,
  title: string,
  artist: string,
  year: number,
  cover: string | undefined,
  tracks: [string, number][],
): Album {
  return {
    id,
    title,
    artist,
    year,
    cover,
    tracks: tracks.map(
      ([name, durationMs], i): Track => ({
        key: `navidrome:${id}-${i + 1}`,
        provider: 'navidrome',
        id: `${id}-${i + 1}`,
        title: name,
        artists: [{ name: artist }],
        album: { id, title, key: `navidrome:${id}` },
        durationMs,
        artwork: cover ? [{ url: cover }] : [],
      }),
    ),
  };
}

export const fixtureLibrary = createLibrary([
  album('al-harbour', 'Harbour Lights', 'Lowfield', 2019, harbourLights, [
    ['Ferry at Six', ms(3, 41)],
    ['Low Tide Radio', ms(4, 12)],
    ['Salt on the Window', ms(3, 58)],
    ['Lighthouse Keeper', ms(5, 3)],
    ['Moorings', ms(2, 47)],
    ['The Long Way Home', ms(6, 20)],
  ]),
  album('al-paper', 'Paper Satellites', 'The Quiet Hours', 2021, paperSatellites, [
    ['Orbit', ms(3, 22)],
    ['Folded Sky', ms(4, 5)],
    ['Ground Control to Nobody', ms(3, 49)],
    ['Weightless', ms(4, 31)],
    ['Re-entry', ms(5, 16)],
  ]),
  album('al-glass', 'Glass Weather', 'Mira Sole', 2023, glassWeather, [
    ['Prism', ms(3, 14)],
    ['Heat Haze', ms(3, 52)],
    ['Neon Rain', ms(4, 2)],
    ['Refraction', ms(3, 37)],
    ['Window Seat', ms(4, 44)],
    ['Afterglow', ms(3, 9)],
    ['Clear Skies by Morning', ms(5, 30)],
  ]),
  album('al-exposure', 'Long Exposure', 'Field Ensemble', 2017, longExposure, [
    ['Aperture', ms(7, 48)],
    ['Grain', ms(9, 2)],
    ['Shutter Held Open for Twelve Minutes', ms(12, 14)],
    ['Developing', ms(6, 31)],
  ]),
  album('al-signal', 'Signal / Noise', 'Ada Varga', 2024, signalNoise, [
    ['Carrier Wave', ms(3, 33)],
    ['Interlude', ms(0, 8)],
    ['Feedback Loop', ms(4, 18)],
    ['Ground Hum', ms(3, 46)],
    ['Clean Signal', ms(4, 1)],
  ]),
  album(
    'al-copper',
    'Copper Rain, Slow Mornings and Other Small Hours of the Year',
    'Lowfield',
    2015,
    undefined, // no cover: the title square (DESIGN_SYSTEM.md §8)
    [
      ['Copper Rain', ms(4, 26)],
      ['Slow Mornings', ms(3, 51)],
      ['Small Hours', ms(5, 2)],
    ],
  ),
  // M3: guide tones for the lyric fixtures (`guide.ts`), played as real audio.
  album(
    GUIDE_ALBUM_ID,
    'Guide Tones',
    'ECHO Fixtures',
    2026,
    undefined,
    guideNames.map((n) => [n, lyricFixtures[n]?.durationMs ?? 0]),
  ),
]);
