// Specimen lyrics: original text written for ECHO (no copyrighted lyrics), a slow ballad with
// 4–7 s lines (docs/LYRICS_EXPERIENCE.md §16, ballad + accents targets). It exercises diacritics
// (é ñ ø ß ç), Latin-Ext (Łódź), ligature pairs (fi, fl, ffl, ffi), apostrophes and em dashes.
// This is specimen data only. The real LyricsDoc fixtures are written in M3.

export interface SpecimenLine {
  text: string;
  startMs: number;
}

export const SONG = { title: 'Every Echo', artist: 'Lumen Varga', album: 'Sodium Hours' };
export const DURATION_MS = 245_000;

export const LINES: SpecimenLine[] = [
  { text: 'The kettle hums a note the walls remember', startMs: 52_400 },
  { text: 'Your coat still hangs where autumn left it — open', startMs: 58_100 },
  { text: 'We wrote our names in flour on the counter', startMs: 64_000 },
  { text: 'and laughed until the café lights went off', startMs: 69_600 },
  { text: 'I keep the radio low so I can hear you', startMs: 75_300 },
  { text: 'Façade of streetlamps bending in the rain', startMs: 81_000 },
  { text: 'Señora downstairs is singing through the floorboards', startMs: 92_800 },
  { text: 'Every echo finds its way back home', startMs: 98_200 },
  { text: 'Don’t let the morning take the last of it', startMs: 103_600 },
  { text: 'Øresund wind in the back of your voice', startMs: 108_100 },
  { text: 'Hold the light — hold it — it’s still ringing', startMs: 112_000 },
  { text: 'Straße after Straße, the city sleeps in amber', startMs: 125_500 },
  { text: 'Affluent with nothing but the afterglow', startMs: 131_000 },
  { text: 'Officially it’s over; unofficially, it’s not', startMs: 136_400 },
  { text: 'Brno to Łódź, the radio keeps time', startMs: 142_200 },
  { text: 'We were the reverb, not the song', startMs: 148_000 },
  { text: 'So stay — the room is warm, the night is long', startMs: 153_900 },
  { text: 'Every echo finds its way back home', startMs: 160_000 },
  { text: 'Every echo, every echo', startMs: 166_000 },
  { text: 'Don’t let the morning take the last of it', startMs: 171_500 },
];

// The frozen moment: line 7 is active and its second word ("echo") is being sung.
export const NOW = { activeIndex: 7, sweepWord: 1, sweepProgress: 0.53, tMs: 99_200 };

// Lines that need a third row at narrow measures, for the wrapping comparison.
export const LONG_LINES = [
  'Straße after Straße, the city sleeps in amber while the last tram sighs',
  'Officially it’s over; unofficially, I still set two cups out every morning',
  'Hold the light — hold it — it’s still ringing in the hallway',
];
