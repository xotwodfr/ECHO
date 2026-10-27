import { describe, expect, it } from 'vitest';
import { AnalyserFeatures, type Tap } from './analyser.ts';

// VISUALIZER_SPEC.md §3.2–§3.5 on synthetic spectra: 1024 bins of 21.5 Hz (44.1 kHz, fftSize 2048).

const N = 1024;
const HZ = 44_100 / 2 / N;
const FRAME = 1000 / 60;

/** A tap whose spectrum is drawn per frame: `level(hz)` in dB. */
function tap(level: (hz: number) => number): Tap & { draw(f: (hz: number) => number): void } {
  let fn = level;
  return {
    frequencyBinCount: N,
    context: { sampleRate: 44_100 },
    draw(f) {
      fn = f;
    },
    getFloatFrequencyData(out) {
      for (let i = 0; i < N; i++) out[i] = fn(i * HZ);
    },
    getFloatTimeDomainData(out) {
      const amp = 10 ** (fn(100) / 20);
      for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin(i / 7);
    },
  };
}

/** Kick + hat every `periodMs` (bass and highs up 40 dB for 60 ms), over a −90 dB floor. */
const groove =
  (t: number, periodMs = 500, gain = 0) =>
  (hz: number) => {
    const hit = t % periodMs < 60;
    if (hz < 250) return (hit ? -25 : -70) + gain;
    if (hz > 4000 && hz < 12000) return (hit ? -35 : -80) + gain;
    return -75 + gain;
  };

function run(
  seconds: number,
  f: (t: number) => (hz: number) => number,
  latencyMs = 0,
  playing = true,
) {
  const t0 = tap(f(0));
  const a = new AnalyserFeatures({
    tap: () => t0,
    latencyMs: () => latencyMs,
    playing: () => playing,
  });
  const out: { t: number; f: ReturnType<AnalyserFeatures['sample']> }[] = [];
  for (let t = 0; t < seconds * 1000; t += FRAME) {
    t0.draw(f(t));
    out.push({ t, f: { ...a.sample(t, FRAME) } });
  }
  return out;
}

describe('live features (§3.2)', () => {
  it('finds the onsets of a 120 BPM groove, at most one per 120 ms', () => {
    const r = run(10, (t) => groove(t));
    const onsets = r.filter((x) => x.f.onset > 0).map((x) => x.t);
    expect(onsets.length).toBeGreaterThanOrEqual(17);
    expect(onsets.length).toBeLessThanOrEqual(21);
    for (let i = 1; i < onsets.length; i++)
      expect((onsets[i] as number) - (onsets[i - 1] as number)).toBeGreaterThanOrEqual(120);
    // Each onset lands within a frame or two of a hit.
    for (const t of onsets.slice(2)) expect(t % 500).toBeLessThan(3 * FRAME);
  });

  // ON-VZ-1: song time goes back at every track change, seek back and repeat; one analyser lives
  // for the whole session, so onsets must not wait for the old song time to come round again.
  it('onsets keep coming after song time jumps back (next track, seek back)', () => {
    const t0 = tap(groove(0));
    const a = new AnalyserFeatures({ tap: () => t0, latencyMs: () => 20, playing: () => true });
    let wall = 0;
    const play = (fromMs: number, seconds: number) => {
      const hits: number[] = [];
      for (let t = fromMs; t < fromMs + seconds * 1000; t += FRAME, wall += FRAME) {
        t0.draw(groove(wall));
        if (a.sample(t, FRAME).onset > 0) hits.push(t);
      }
      return hits;
    };
    expect(play(230_000, 10).length).toBeGreaterThanOrEqual(15); // the end of a 4-minute track
    expect(play(0, 5).length).toBeGreaterThanOrEqual(7); // the next track, from 0:00
  });

  it('bands follow their own range: a bass groove moves bass, not mid', () => {
    const r = run(8, (t) => groove(t)).slice(-120);
    expect(Math.max(...r.map((x) => x.f.bass))).toBeGreaterThan(0.6);
    expect(Math.max(...r.map((x) => x.f.mid))).toBeLessThan(Math.max(...r.map((x) => x.f.bass)));
    expect(Math.max(...r.map((x) => x.f.bassImpulse))).toBeGreaterThan(0.3);
    // Intensity rises with loudness and onset rate: a groove sits well above silence.
    const busy = r.at(-1)?.f.intensity ?? 0;
    const still = run(8, () => () => -95).at(-1)?.f.intensity ?? 1; // quiet, not an empty spectrum
    expect(busy - still).toBeGreaterThan(0.15);
  });

  it('normalised by the running p95: 20 dB quieter reacts about the same', () => {
    const loud = run(10, (t) => groove(t, 500, 0)).slice(-120);
    const quiet = run(10, (t) => groove(t, 500, -20)).slice(-120);
    const peak = (r: typeof loud) => Math.max(...r.map((x) => x.f.bass));
    expect(Math.abs(peak(loud) - peak(quiet))).toBeLessThan(0.15);
  });

  it('near-silence stays near zero (the p95 floor at −60 dBFS)', () => {
    const r = run(6, () => () => -100).slice(-60);
    expect(Math.max(...r.map((x) => x.f.bass + x.f.mid + x.f.high))).toBeLessThan(0.1);
    expect(r.every((x) => x.f.onset === 0)).toBe(true);
  });
});

describe('latency and failure (§3.3, §3.5)', () => {
  it('features are read back `outputLatency` later', () => {
    const now = run(4, (t) => groove(t), 0);
    const late = run(4, (t) => groove(t), 150);
    const first = (r: typeof now) => r.find((x) => x.t > 2000 && x.f.onset > 0)?.t ?? 0;
    expect(first(late) - first(now)).toBeGreaterThanOrEqual(150 - FRAME);
    expect(first(late) - first(now)).toBeLessThanOrEqual(150 + 2 * FRAME);
  });

  it('a spectrum that stays empty while playing for 3 s turns features off, and back on with sound', () => {
    let silent = true;
    const r = run(6, (t) => (silent && t < 4000 ? () => Number.NEGATIVE_INFINITY : groove(t)));
    silent = false;
    expect(r.find((x) => x.t > 1000 && x.t < 2900)?.f.available).toBe(true);
    expect(r.find((x) => x.t > 3100 && x.t < 3900)?.f.available).toBe(false);
    expect(r.at(-1)?.f.available).toBe(true);
    // Paused: silence is just silence.
    const paused = run(5, () => () => Number.NEGATIVE_INFINITY, 0, false);
    expect(paused.at(-1)?.f.available).toBe(true);
  });
});
