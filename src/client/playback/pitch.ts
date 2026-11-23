// Karaoke mode's key change (docs/KARAOKE.md): the pitch moves by whole semitones and the tempo
// stays. WSOLA (waveform-similarity overlap-add, the method SoundTouch uses) with resampled grains:
// each grain reads the input at the pitch ratio, and is placed where it lines up best with the
// previous grain's natural continuation, so the waveform runs on without a phase jump. The grain
// positions follow the input at the normal rate, which keeps the song's speed and its clock.
//
// Plain TypeScript, so it runs in the AudioWorklet (pitch.worklet.ts) and in unit tests alike.

/** A shift of `n` semitones as a frequency ratio (equal temperament). */
export const semitoneRatio = (n: number) => 2 ** (n / 12);

/** Karaoke's key range, in semitones either way. */
export const KEY_RANGE = 6;

/** The highest ratio the buffers are sized for (a little over +6 semitones). */
const MAX_RATIO = 1.5;
/** Grain length; 40 ms carries a sung note well (SoundTouch's music setting is 40–80). */
const GRAIN_S = 0.04;
/** How far a grain may move to line up: one period of a voice down to about 85 Hz. */
const SEEK_S = 0.012;

/** The shifter's latency in samples: half a grain either way at the top ratio, and the seek. */
export function pitchDelay(sampleRate: number) {
  const grain = 2 * Math.round((GRAIN_S * sampleRate) / 2);
  return Math.ceil(grain / 2 + (MAX_RATIO * grain) / 2 + Math.round(SEEK_S * sampleRate) + 8);
}

export class PitchShifter {
  /** Grain length and hop, in samples (half overlap, so the Hann windows sum to one). */
  readonly grain: number;
  readonly hop: number;
  private readonly seek: number;
  /** How far the output runs behind the input, in samples: the node's latency. */
  readonly delay: number;
  private readonly channels: number;
  private readonly mask: number;
  private readonly input: Float32Array[];
  /** The channels summed, for the alignment search. */
  private readonly mono: Float32Array;
  private readonly out: Float32Array[];
  private readonly window: Float32Array;
  private readonly target: Float32Array;
  private ratio = 1;
  /** Input samples written so far. */
  private written = 0;
  /** The next grain to place. */
  private frame = 0;
  /** Where the previous grain started reading, in input samples; NaN before the first. */
  private previous = Number.NaN;

  constructor(sampleRate: number, channels = 2) {
    this.channels = channels;
    this.hop = Math.round((GRAIN_S * sampleRate) / 2);
    this.grain = this.hop * 2;
    this.seek = Math.round(SEEK_S * sampleRate);
    this.delay = pitchDelay(sampleRate);
    let size = 1;
    while (size < 4 * (this.delay + this.grain * MAX_RATIO + this.seek)) size *= 2;
    this.mask = size - 1;
    this.input = Array.from({ length: channels }, () => new Float32Array(size));
    this.mono = new Float32Array(size);
    this.out = Array.from({ length: channels }, () => new Float32Array(size));
    this.window = new Float32Array(this.grain);
    for (let j = 0; j < this.grain; j++)
      this.window[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / this.grain);
    this.target = new Float32Array(Math.ceil(this.hop * MAX_RATIO) + 4);
  }

  /** The frequency ratio, clamped to what the buffers allow. */
  setRatio(r: number) {
    this.ratio = Math.min(MAX_RATIO, Math.max(1 / MAX_RATIO, r));
  }

  /** Forget the audio so far (the node was put back in the chain). */
  reset() {
    for (const c of this.input) c.fill(0);
    for (const c of this.out) c.fill(0);
    this.mono.fill(0);
    this.written = 0;
    this.frame = 0;
    this.previous = Number.NaN;
  }

  /** One block: `input` channels in (a missing or mono input is fine), `output` filled. */
  process(input: readonly Float32Array[], output: Float32Array[], frames: number) {
    const { mask, channels } = this;
    const first = input[0];
    for (let i = 0; i < frames; i++) {
      const at = (this.written + i) & mask;
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        const src = input[c] ?? first;
        const x = src ? (src[i] as number) : 0;
        (this.input[c] as Float32Array)[at] = x;
        sum += x;
      }
      this.mono[at] = sum;
    }
    this.written += frames;
    const end = this.written - this.delay; // the output emitted up to here
    while (this.frame * this.hop < end) this.place();
    const start = end - frames;
    for (let c = 0; c < output.length; c++) {
      const o = output[c] as Float32Array;
      const ring = this.out[Math.min(c, channels - 1)] as Float32Array;
      for (let i = 0; i < frames; i++) {
        const t = start + i;
        if (t < 0) {
          o[i] = 0;
          continue;
        }
        o[i] = ring[t & mask] as number;
      }
    }
    // Emitted: clear it for the grains that land there later.
    for (const ring of this.out) for (let t = Math.max(0, start); t < end; t++) ring[t & mask] = 0;
  }

  /** Input sample `t` of the summed channels (silence before the start). */
  private monoAt(t: number) {
    return t < 0 ? 0 : (this.mono[t & this.mask] as number);
  }

  /** Places grain `frame`: aligned, resampled at the ratio, windowed, overlap-added. */
  private place() {
    const { grain, hop, ratio: r, mask } = this;
    const k = this.frame++;
    // The grain is centred on its own output time, so the input keeps pace with the output.
    const nominal = k * hop + grain / 2 - (r * grain) / 2;
    let pos = nominal;
    if (!Number.isNaN(this.previous)) {
      // Line up against the continuation, by a (sub-sample) shift from where it would be.
      const cont = this.previous + hop * r;
      pos = cont + this.align(cont, Math.round(nominal - cont));
    }
    this.previous = pos;
    for (let c = 0; c < this.channels; c++) {
      const src = this.input[c] as Float32Array;
      const ring = this.out[c] as Float32Array;
      for (let j = 0; j < grain; j++) {
        const x = pos + j * r;
        const i = Math.floor(x);
        const f = x - i;
        // Catmull-Rom between the four samples around x.
        const y0 = i - 1 < 0 ? 0 : (src[(i - 1) & mask] as number);
        const y1 = i < 0 ? 0 : (src[i & mask] as number);
        const y2 = i + 1 < 0 ? 0 : (src[(i + 1) & mask] as number);
        const y3 = i + 2 < 0 ? 0 : (src[(i + 2) & mask] as number);
        const v =
          y1 +
          0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
        const o = (k * hop + j) & mask;
        ring[o] = (ring[o] as number) + v * (this.window[j] as number);
      }
    }
  }

  /**
   * The shift from the continuation `cont` (near `around`, within ±seek of it) at which the input
   * best matches how the previous grain would have gone on: normalised cross-correlation of the
   * summed channels, coarse then fine, and a parabola through the peak for the fraction.
   */
  private align(cont: number, around: number) {
    const { hop, ratio: r, seek } = this;
    const len = Math.min(this.target.length, Math.floor(hop * r));
    const from = Math.floor(cont);
    for (let i = 0; i < len; i++) this.target[i] = this.monoAt(from + i);
    const score = (m: number, step: number) => {
      let xy = 0;
      let yy = 1e-9;
      const base = from + m;
      for (let i = 0; i < len; i += step) {
        const y = this.monoAt(base + i);
        xy += (this.target[i] as number) * y;
        yy += y * y;
      }
      return xy / Math.sqrt(yy);
    };
    let best = around;
    let top = Number.NEGATIVE_INFINITY;
    for (let m = around - seek; m <= around + seek; m += 2) {
      const s = score(m, 4);
      if (s > top) {
        top = s;
        best = m;
      }
    }
    const coarse = best;
    top = Number.NEGATIVE_INFINITY;
    for (let m = coarse - 2; m <= coarse + 2; m++) {
      const s = score(m, 1);
      if (s > top) {
        top = s;
        best = m;
      }
    }
    const a = score(best - 1, 1);
    const c = score(best + 1, 1);
    const curve = a - 2 * top + c;
    const frac = curve < 0 ? (0.5 * (a - c)) / curve : 0;
    return best + Math.max(-0.5, Math.min(0.5, frac));
  }
}
