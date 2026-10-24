import type { Features } from '../../../shared/types.ts';
import { LYRICS } from './lyricsConfig.ts';
import { SPRINGS, type Spring, snap, spring, step } from './springs.ts';

// The lyric field's response to the music (LYRICS_EXPERIENCE.md §12): one set of beat terms per
// frame, from the recorded or live Features, with the readability caps of §12.4 applied after
// summing. No DOM, no per-line state: lines read these terms in `model.ts`.

const B = LYRICS.beat;
const G = LYRICS.glow;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** The user's intensity setting multiplies the background terms only (§12.2). */
export type IntensitySetting = keyof typeof B.setting;

/** Peak of the impulse spring's response to a unit velocity kick: x(t) = v₀/ω_d·e^(−ζωt)·sin ω_d t. */
const { f, zeta } = SPRINGS.impulse;
const W0 = 2 * Math.PI * f;
const WD = W0 * Math.sqrt(1 - zeta * zeta);
const T_PEAK = Math.atan2(WD, zeta * W0) / WD;
/** The kick that makes a unit impulse peak at 1. */
export const UNIT_KICK = WD / (Math.exp(-zeta * W0 * T_PEAK) * Math.sin(WD * T_PEAK));

export interface BeatTerms {
  g: number; // motion gain (§12.2)
  pulse: number; // active line scale, added to 1 (≤ scaleMax)
  lean: number; // z shift toward the viewer for +1…+3 (≥ 0, ≤ zLean)
  kick: number[]; // background translate per blur bucket, px along each line's own direction
  sustain: number; // 0…1, glow radius and alpha (§12.3)
  glowAdd: number; // intense passages: +0.05 alpha
  speed: number; // background drift speed
  breathe: number; // background opacity breathing amplitude, ×
  drift: number; // approach drift fraction (§4.3)
}

export interface BeatInput {
  features: Features;
  dt: number;
  /** ms since the current hand-over; < quietMs means no beat response (§12.4). */
  sinceHandover: number;
  /** 0…1: the sustained-vocal heuristic before smoothing (word elapsed × mid, or mid). */
  vocal: number;
  /** still: one deterministic frame, no transients; scrub: no new impulses. */
  mode: 'run' | 'scrub' | 'still';
  /** Reduced motion (§10): no beat response on text at all. */
  reduced: boolean;
}

export class Beat {
  private bass: Spring = spring(0);
  private perc: Spring[] = [spring(0), spring(0), spring(0)];
  private percTurn = 0;
  private sustainV = 0;
  private quietFor = 0;
  private quiet = 0; // 0…1, blended over 2 s
  private intense = 0;
  readonly setting: number;

  constructor(setting: IntensitySetting = 'expressive') {
    this.setting = B.setting[setting];
  }

  update(i: BeatInput): BeatTerms {
    const { features: ft, dt } = i;
    const on = ft.available && !i.reduced;
    const g = ft.available ? 0.35 + 0.65 * clamp(ft.intensity, 0, 1) : 0.6;
    const still = i.mode === 'still';

    // Bass: the positive derivative of the bass envelope is a force on the impulse spring.
    // Percussion: each onset kicks one bucket's spring, in turn (per bucket, not per line, §12.3).
    if (still || !on) {
      snap(this.bass, 0);
      for (const s of this.perc) snap(s, 0);
    } else {
      step(this.bass, 0, SPRINGS.impulse, dt);
      for (const s of this.perc) step(s, 0, SPRINGS.impulse, dt);
      if (i.mode === 'run') {
        this.bass.v += B.bassForce * UNIT_KICK * ft.bassImpulse * dt;
        if (ft.onset > 0) {
          (this.perc[this.percTurn] as Spring).v += UNIT_KICK * ft.onset;
          this.percTurn = (this.percTurn + 1) % 3;
        }
      }
    }

    // Sustained vocals: attack 120 ms, release 400 ms.
    const vocal = clamp(i.vocal, 0, 1);
    if (still) this.sustainV = vocal;
    else {
      const tau = vocal > this.sustainV ? B.sustainAttackMs : B.sustainReleaseMs;
      this.sustainV += (vocal - this.sustainV) * (1 - Math.exp(-dt / tau));
    }

    // Quiet (intensity < 0.2 for 4 s) and intense (> 0.75) passages, each blended over 2 s.
    const q = ft.intensity < B.quietBelow;
    this.quietFor = q ? this.quietFor + dt : 0;
    const quietOn = ft.available && (still ? q : this.quietFor >= B.quietForMs);
    const intenseOn = ft.available && ft.intensity > B.intenseAbove;
    const blend = (v: number, target: boolean) =>
      still ? (target ? 1 : 0) : clamp(v + ((target ? 1 : -1) * dt) / B.passageMs, 0, 1);
    this.quiet = blend(this.quiet, quietOn);
    this.intense = blend(this.intense, intenseOn);

    // §12.4: nothing for 300 ms after a hand-over, then in over 100 ms; every term clamped after
    // summing.
    const gate = on ? smoothstep(B.quietMs, B.quietMs + 100, i.sinceHandover) : 0;
    const bg = this.setting;
    // Speed and breathing change by the passage, scaled by the setting (background terms only).
    const speed = 1 + bg * (-(1 - B.quietSpeed) * this.quiet + (B.intenseSpeed - 1) * this.intense);
    return {
      g,
      pulse: clamp(B.scaleMax * g * this.bass.x * gate, -B.scaleCap, B.scaleCap),
      lean: clamp(B.zLean * g * ft.bass * gate, 0, B.zLean),
      kick: this.perc.map((s) => clamp(B.kickPx * g * bg * s.x * gate, -B.kickPx, B.kickPx)),
      sustain: i.reduced ? 0 : this.sustainV,
      glowAdd: i.reduced ? 0 : B.intenseGlow * this.intense,
      speed: i.reduced ? 1 : Math.max(0.1, speed),
      breathe: 1 - 0.5 * this.quiet,
      drift: LYRICS.zone.drift + (B.intenseDrift - LYRICS.zone.drift) * this.intense,
    };
  }
}

/** The sustained-vocal heuristic (§12.3) for the active line at `t`. */
export function vocalAt(
  words: readonly { start: number; end: number }[] | undefined,
  lineActive: boolean,
  mid: number,
  t: number,
) {
  if (!lineActive) return 0;
  if (!words?.length) return mid; // line-timed: mid while the line is active
  const w = words.find((x) => t >= x.start && t < x.end);
  return w ? smoothstep(600, 1500, t - w.start) * mid : 0;
}

/** Glow alpha and radius for a sustain level (§12.3), capped at alphaMax. */
export const glowFor = (sustain: number, add: number) => ({
  alpha: Math.min(G.alphaMax, G.alpha + (G.alphaMax - G.alpha) * sustain + add),
  radius: G.radius + (G.radiusMax - G.radius) * sustain,
});
