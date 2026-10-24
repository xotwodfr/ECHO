import type { FeatureSource, Features } from '../../shared/types.ts';
import { SILENT_FEATURES } from './features.ts';

// Live features from the analyser tap (VISUALIZER_SPEC.md §3.2–§3.5): four bands with one-pole
// envelopes, each normalised by its own running 95th percentile (a decaying 64-bucket histogram
// with a −60 dBFS floor, so near-silence stays near zero), spectral-flux onsets against the median
// and MAD of the last 1.5 s, RMS, intensity, and bassImpulse. Features are stamped and read back
// `outputLatency` later, so the room reacts to what is audible now. Nothing is allocated per frame.

/** The parts of an AnalyserNode this reads, so tests can feed spectra. */
export interface Tap {
  readonly frequencyBinCount: number;
  readonly context: { readonly sampleRate: number };
  getFloatFrequencyData(out: Float32Array<ArrayBuffer>): void;
  getFloatTimeDomainData(out: Float32Array<ArrayBuffer>): void;
}

interface Band {
  lo: number; // Hz
  hi: number;
  attackMs: number;
  releaseMs: number;
}
const BANDS: Band[] = [
  { lo: 20, hi: 60, attackMs: 10, releaseMs: 180 }, // sub
  { lo: 20, hi: 250, attackMs: 10, releaseMs: 180 }, // bass
  { lo: 250, hi: 4000, attackMs: 25, releaseMs: 250 }, // mid
  { lo: 4000, hi: 12000, attackMs: 5, releaseMs: 120 }, // high
];
const FLUX = { lo: 2000, hi: 12000 };
const DB_MIN = -100;
const DB_FLOOR = -60; // the p95 never drops below this
const BUCKETS = 64;
const DECAY = 0.995; // 0.5% per frame
const FLUX_WINDOW = 90; // frames ≈ 1.5 s at 60 Hz
const ONSET_GAP_MS = 120;
const RATE_WINDOW_MS = 4000;
const RING = 64;
const SILENT_MS = 3000;

/** A running 95th percentile of dB values: a 64-bucket histogram that forgets 0.5% per frame. */
class P95 {
  private readonly h = new Float64Array(BUCKETS);
  private total = 0;
  add(db: number) {
    for (let i = 0; i < BUCKETS; i++) this.h[i] = (this.h[i] as number) * DECAY;
    this.total = this.total * DECAY + 1;
    const k = Math.max(0, Math.min(BUCKETS - 1, Math.floor(((db - DB_MIN) / -DB_MIN) * BUCKETS)));
    this.h[k] = (this.h[k] as number) + 1;
  }
  /** dB at the 95th percentile, never below the floor. */
  value() {
    let acc = 0;
    for (let i = 0; i < BUCKETS; i++) {
      acc += this.h[i] as number;
      if (acc >= 0.95 * this.total)
        return Math.max(DB_FLOOR, DB_MIN + ((i + 1) / BUCKETS) * -DB_MIN);
    }
    return DB_FLOOR;
  }
}

const toDb = (power: number) => (power > 0 ? 10 * Math.log10(power) : DB_MIN);
/** A band's power divided by its p95 power, clamped to 0..1. */
const norm = (db: number, p95: number) => Math.min(1, Math.max(0, 10 ** ((db - p95) / 10)));
const onePole = (prev: number, x: number, dtMs: number, attackMs: number, releaseMs: number) =>
  prev + (x - prev) * (1 - Math.exp(-dtMs / (x > prev ? attackMs : releaseMs)));

export class AnalyserFeatures implements FeatureSource {
  private spectrum = new Float32Array(0) as Float32Array<ArrayBuffer>;
  private time = new Float32Array(0) as Float32Array<ArrayBuffer>;
  private prevMag = new Float32Array(0);
  private readonly bandP95 = BANDS.map(() => new P95());
  private readonly rmsP95 = new P95();
  private readonly env = new Float64Array(BANDS.length);
  private readonly values = new Float64Array(BANDS.length);
  private readonly flux = new Float64Array(FLUX_WINDOW);
  private readonly sorted = new Float64Array(FLUX_WINDOW);
  private fluxN = 0;
  private fluxAt = 0;
  private readonly onsets = new Float64Array(64); // times of recent onsets, a ring
  private onsetHead = 0;
  private lastOnset = Number.NEGATIVE_INFINITY;
  private rms = 0;
  private intensity = 0.6;
  private prevBass = 0;
  private silentFor = 0;
  private dead = false;
  /** Features stamped with the time they were computed, read back `latency` later (§3.3). */
  private readonly ring: (Features & { t: number })[] = Array.from({ length: RING }, () => ({
    t: Number.NEGATIVE_INFINITY,
    ...SILENT_FEATURES.sample(0, 0),
  }));
  private head = 0;

  private readonly tap: () => Tap | null;
  private readonly latencyMs: () => number;
  private readonly playing: () => boolean;

  constructor(opts: { tap: () => Tap | null; latencyMs: () => number; playing: () => boolean }) {
    this.tap = opts.tap;
    this.latencyMs = opts.latencyMs;
    this.playing = opts.playing;
  }

  sample(tMs: number, dtMs: number): Features {
    const tap = this.tap();
    if (!tap || dtMs <= 0) return this.read(tMs);
    const n = tap.frequencyBinCount;
    if (this.spectrum.length !== n) {
      this.spectrum = new Float32Array(n) as Float32Array<ArrayBuffer>;
      this.time = new Float32Array(n * 2) as Float32Array<ArrayBuffer>;
      this.prevMag = new Float32Array(n);
    }
    tap.getFloatFrequencyData(this.spectrum);
    tap.getFloatTimeDomainData(this.time);
    const hzPerBin = tap.context.sampleRate / 2 / n;
    const bin = (hz: number) => Math.min(n - 1, Math.max(0, Math.round(hz / hzPerBin)));

    // §3.5: a spectrum that stays empty while playing means no features (taint, a codec path that
    // bypasses Web Audio). It recovers as soon as sound arrives.
    let any = false;
    for (let i = 0; i < n; i++)
      if (Number.isFinite(this.spectrum[i]) && (this.spectrum[i] as number) > DB_MIN) {
        any = true;
        break;
      }
    if (!any && this.playing()) {
      this.silentFor += dtMs;
      if (this.silentFor >= SILENT_MS && !this.dead) {
        this.dead = true;
        console.warn('features.silent');
      }
    } else if (any) {
      this.silentFor = 0;
      this.dead = false;
    }

    // Bands: linear power summed over their bins, in dB, normalised by the band's p95.
    const out = this.ring[this.head] as Features & { t: number };
    const values = this.values;
    for (let b = 0; b < BANDS.length; b++) {
      const band = BANDS[b] as Band;
      let p = 0;
      for (let i = bin(band.lo); i <= bin(band.hi); i++) {
        const db = this.spectrum[i] as number;
        if (Number.isFinite(db)) p += 10 ** (db / 10);
      }
      const db = toDb(p);
      const p95 = this.bandP95[b] as P95;
      p95.add(db);
      const v = norm(db, p95.value());
      this.env[b] = onePole(this.env[b] as number, v, dtMs, band.attackMs, band.releaseMs);
      values[b] = this.env[b] as number;
    }

    // Spectral flux over 2–12 kHz (half-wave rectified, log magnitude).
    let f = 0;
    const fluxLo = bin(FLUX.lo);
    const fluxHi = bin(FLUX.hi);
    for (let i = fluxLo; i <= fluxHi; i++) {
      const mag = Number.isFinite(this.spectrum[i]) ? (this.spectrum[i] as number) : DB_MIN;
      const d = mag - (this.prevMag[i] as number);
      if (d > 0) f += d;
      this.prevMag[i] = mag;
    }
    this.flux[this.fluxAt] = f;
    this.fluxAt = (this.fluxAt + 1) % FLUX_WINDOW;
    this.fluxN = Math.min(FLUX_WINDOW, this.fluxN + 1);
    const median = this.median();
    let mad = 0;
    for (let i = 0; i < this.fluxN; i++)
      this.sorted[i] = Math.abs((this.flux[i] as number) - median);
    mad = this.medianOfSorted();
    // A floor of 0.5 dB of rise per bin: a perfectly steady signal (MAD 0) is not all onsets.
    const threshold = median + 1.5 * mad + 0.5 * (fluxHi - fluxLo + 1);
    let onset = 0;
    if (this.fluxN >= 10 && f > threshold && tMs - this.lastOnset >= ONSET_GAP_MS) {
      onset = Math.min(1, (f - threshold) / threshold);
      this.lastOnset = tMs;
      this.onsets[this.onsetHead] = tMs;
      this.onsetHead = (this.onsetHead + 1) % this.onsets.length;
    }

    // RMS (300 ms) and intensity (2 s): loudness and how busy the music is.
    let sq = 0;
    for (let i = 0; i < this.time.length; i++) sq += (this.time[i] as number) ** 2;
    const rmsDb = toDb(sq / Math.max(1, this.time.length));
    this.rmsP95.add(rmsDb);
    this.rms = onePole(this.rms, norm(rmsDb, this.rmsP95.value()), dtMs, 300, 300);
    let recent = 0;
    for (const t of this.onsets) if (tMs - t < RATE_WINDOW_MS) recent++;
    const rate = Math.min(1, recent / (RATE_WINDOW_MS / 1000) / 4); // 4 onsets/s counts as busy
    this.intensity = onePole(this.intensity, 0.7 * this.rms + 0.3 * rate, dtMs, 2000, 2000);

    const bass = values[1] as number;
    const impulse = Math.min(1, Math.max(0, ((bass - this.prevBass) / Math.max(1, dtMs)) * 40));
    this.prevBass = bass;

    out.t = tMs;
    out.available = !this.dead;
    out.sub = values[0] as number;
    out.bass = bass;
    out.mid = values[2] as number;
    out.high = values[3] as number;
    out.onset = onset;
    out.intensity = this.intensity;
    out.bassImpulse = impulse;
    this.head = (this.head + 1) % RING;
    return this.read(tMs);
  }

  /** The newest features at least `latency` old (§3.3), or silence before there are any. */
  private read(tMs: number): Features {
    const at = tMs - this.latencyMs();
    let best: (Features & { t: number }) | null = null;
    for (const e of this.ring) if (e.t <= at && (!best || e.t > best.t)) best = e;
    if (!best || best.t === Number.NEGATIVE_INFINITY || !best.available)
      return SILENT_FEATURES.sample(tMs, 0);
    return best;
  }

  private median() {
    for (let i = 0; i < this.fluxN; i++) this.sorted[i] = this.flux[i] as number;
    return this.medianOfSorted();
  }

  /** Median of sorted[0..fluxN) (sorts that range in place). */
  private medianOfSorted() {
    const view = this.sorted.subarray(0, this.fluxN);
    view.sort();
    const m = this.fluxN >> 1;
    return this.fluxN % 2
      ? (view[m] as number)
      : ((view[m - 1] as number) + (view[m] as number)) / 2;
  }
}
