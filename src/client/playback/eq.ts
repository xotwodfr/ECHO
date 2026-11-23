// The equalizer (Settings → Playback → Equalizer): ten bands an octave apart, the first a low shelf
// and the last a high shelf, the rest peaking filters. The presets are the same on Android
// (Android/…/playback/Effects.kt), where they are read off at the phone's own bands.

/** The bands' centre frequencies in Hz. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
/** How far a band moves either way, in dB. */
export const EQ_MAX_DB = 12;
/** One octave wide (Q = √2) for the peaking bands. */
export const EQ_Q = Math.SQRT2;

export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  vocal: [-2, -2, -1, 0, 2, 4, 4, 2, 0, -1],
  loudness: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5],
  acoustic: [4, 4, 3, 1, 1, 1, 2, 3, 3, 2],
  electronic: [4, 4, 1, 0, -2, 1, 0, 1, 4, 5],
} as const satisfies Record<string, readonly number[]>;

export type EqPreset = keyof typeof EQ_PRESETS | 'custom';
export const EQ_PRESET_IDS = [...(Object.keys(EQ_PRESETS) as EqPreset[]), 'custom'] as const;

/** The gains in effect: a preset's, or the custom curve (padded or cut to ten bands, clamped). */
export function eqGains(preset: EqPreset, custom: readonly number[]): number[] {
  const g = preset === 'custom' ? custom : EQ_PRESETS[preset];
  return EQ_BANDS.map((_, i) => Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, g[i] ?? 0)));
}

/** Headroom so boosts don't clip: the largest boost, taken off before the filters. */
export const eqPreampDb = (gains: readonly number[]) => -Math.max(0, ...gains);

export type BandType = 'lowshelf' | 'peaking' | 'highshelf';
export const bandType = (i: number): BandType =>
  i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';

/**
 * The filter frequency for band `i`: a peaking band's centre; a shelf's corner half an octave in
 * from its band, so the shelf is near its full gain at the band's own frequency and beyond.
 */
export function bandFrequency(i: number) {
  const f = EQ_BANDS[i] ?? 1000;
  const t = bandType(i);
  return t === 'lowshelf' ? f * Math.SQRT2 : t === 'highshelf' ? f / Math.SQRT2 : f;
}

/**
 * One band's response at `hz` in dB, by the Audio EQ Cookbook formulas that Web Audio's
 * BiquadFilterNode uses (shelves with slope 1, the shape the node uses).
 */
export function bandResponseDb(
  type: BandType,
  f0: number,
  gainDb: number,
  hz: number,
  rate: number,
) {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * f0) / rate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  if (type === 'peaking') {
    const alpha = sin / (2 * EQ_Q);
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else {
    const alpha = (sin / 2) * Math.SQRT2; // shelf slope S = 1
    const k = 2 * Math.sqrt(A) * alpha;
    const s = type === 'lowshelf' ? 1 : -1;
    b0 = A * (A + 1 - s * (A - 1) * cos + k);
    b1 = s * 2 * A * (A - 1 - s * (A + 1) * cos);
    b2 = A * (A + 1 - s * (A - 1) * cos - k);
    a0 = A + 1 + s * (A - 1) * cos + k;
    a1 = -s * 2 * (A - 1 + s * (A + 1) * cos);
    a2 = A + 1 + s * (A - 1) * cos - k;
  }
  const w = (2 * Math.PI * hz) / rate;
  const mag = (c0: number, c1: number, c2: number) => {
    const re = c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w);
    const im = -c1 * Math.sin(w) - c2 * Math.sin(2 * w);
    return Math.hypot(re, im);
  };
  return 20 * Math.log10(mag(b0, b1, b2) / mag(a0, a1, a2));
}

/** The whole equalizer's response at `hz` in dB, preamp included. */
export function eqResponseDb(gains: readonly number[], hz: number, rate = 48_000) {
  let db = eqPreampDb(gains);
  EQ_BANDS.forEach((_, i) => {
    db += bandResponseDb(bandType(i), bandFrequency(i), gains[i] ?? 0, hz, rate);
  });
  return db;
}
