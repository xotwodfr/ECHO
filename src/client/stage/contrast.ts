import { linearSrgbToOklab, oklabToLinearSrgb, parseColor, type Vec3 } from '../../shared/oklab.ts';
import { opacityAt, unlitMixAt } from './lyrics/model.ts';

// Lyric contrast guarantees (DESIGN_SYSTEM.md §3.4; VISUALIZER_SPEC.md §5.4, §6.5). The room is
// measured, not assumed: the probe pass reports `roomPeakL`, the 95th-percentile OKLab L of the
// environment behind the lyrics. Each role is checked against it, and when a floor fails the room is
// darkened in the lyric zone (never the ink hue changed): exposure first, down to −40%, then a
// neutral shadow scrim behind the active line, up to 0.45. Pure, so the rules are unit-tested.

export const FLOORS = { active: 7, lit: 4.5, zone: 3 } as const;
export const EXPOSURE_MIN = -0.4;
export const SCRIM_MAX = 0.45;
const SLEW_PER_S = 0.5;
/** Release only with this much margin, so the controller does not hunt around a floor. */
const RELEASE = 1.08;
/** The upcoming lines' distances (LYRICS_EXPERIENCE.md §4: 0.25 per line). */
const ZONE_Z = [0.25, 0.5, 0.75];

/** The CSS colours the lyric inks derive from (stage.css). */
export interface Inks {
  inkActive: string; // --lyric-ink-active
  room: string; // --art-room
  text: string; // --text
  highlight: string; // --art-highlight; --lit-base is text mixed 18% toward it
}

const Y = (rgb: Vec3) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
function mixLab(a: Vec3, b: Vec3, k: number) {
  const lb = linearSrgbToOklab(b);
  return oklabToLinearSrgb(
    linearSrgbToOklab(a).map((v, i) => v + ((lb[i] as number) - v) * k) as Vec3,
  );
}

/** The room's peak behind each role: the active line's band and the upcoming lines' band. */
export interface Peaks {
  active: number;
  zone: number;
}

/**
 * Contrast of each lyric role against the room behind it, whose brightest part (95th percentile)
 * has OKLab L `peaks.active` behind the active line and `peaks.zone` behind +1…+3. A number means
 * one peak for both.
 */
export function contrastAt(inks: Inks, peaks: Peaks | number) {
  const p = typeof peaks === 'number' ? { active: peaks, zone: peaks } : peaks;
  // A neutral of lightness L has linear channels L³ (OKLab is cube-root based).
  const activeL = Math.max(0, p.active) ** 3;
  const bgL = Math.max(0, p.zone) ** 3;
  const bg: Vec3 = [bgL, bgL, bgL];
  const ink = parseColor(inks.inkActive).rgb;
  const room = parseColor(inks.room).rgb;
  const lit = mixLab(parseColor(inks.text).rgb, parseColor(inks.highlight).rgb, 0.18);
  const zone = ZONE_Z.map((z) => {
    // The line is drawn at its distance's opacity over bg.
    const c = mixLab(ink, room, unlitMixAt(z));
    const o = opacityAt(z);
    return ratio(Y(c.map((v, i) => v * o + (bg[i] as number) * (1 - o)) as Vec3), bgL);
  });
  return {
    active: ratio(Y(mixLab(ink, room, unlitMixAt(0))), activeL),
    lit: ratio(Y(lit), activeL),
    zone,
  };
}

export type Report = ReturnType<typeof contrastAt>;

/**
 * How many upcoming lines the solver enforces: all three (docs/reviews/M4.md, owner decision
 * 2026-10-27). In the column their ink is no longer mixed toward the room, only dimmed.
 */
export const ENFORCED_ZONE = 3;

/** True when every enforced floor holds, with `margin` (1 = exactly). */
export function passes(r: Report, margin = 1) {
  return (
    r.active >= FLOORS.active * margin &&
    r.lit >= FLOORS.lit * margin &&
    r.zone.slice(0, ENFORCED_ZONE).every((z) => z >= FLOORS.zone * margin)
  );
}

export interface Solve {
  exposure: number; // EXPOSURE_MIN … 0, added to 1 in the lyric zone
  scrim: number; // 0 … SCRIM_MAX
}

/**
 * One controller step: darken while a floor fails (exposure first, then the scrim), lighten back
 * once every floor holds with margin (the scrim first). Slew-limited at 0.5/s; `dtMs` = Infinity
 * jumps (deterministic frames converge by repeated probing).
 */
export function solveStep(s: Solve, r: Report, dtMs: number): Solve {
  const d = Math.min(1, (SLEW_PER_S * dtMs) / 1000);
  if (!passes(r)) {
    if (s.exposure > EXPOSURE_MIN)
      return { ...s, exposure: Math.max(EXPOSURE_MIN, s.exposure - d) };
    // The scrim sits behind the active line only: it cannot help +1…+3, so only the active and
    // lit floors call for it.
    if (r.active < FLOORS.active || r.lit < FLOORS.lit)
      return { ...s, scrim: Math.min(SCRIM_MAX, s.scrim + d) };
    return s;
  }
  if (!passes(r, RELEASE)) return s;
  if (s.scrim > 0) return { ...s, scrim: Math.max(0, s.scrim - d) };
  return { ...s, exposure: Math.min(0, s.exposure + d) };
}

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * 95th-percentile OKLab L of RGBA8 sRGB pixels (the probe readback), optionally of rows
 * `from`…`to` only of the 8-wide grid.
 */
export function peakL(pixels: Uint8Array, from = 0, to = pixels.length / 32 - 1) {
  const ls: number[] = [];
  for (let i = from * 32; i < (to + 1) * 32 && i < pixels.length; i += 4)
    ls.push(
      linearSrgbToOklab([
        lin(pixels[i] as number),
        lin(pixels[i + 1] as number),
        lin(pixels[i + 2] as number),
      ])[0],
    );
  ls.sort((a, b) => a - b);
  return ls[Math.min(ls.length - 1, Math.floor(0.95 * ls.length))] ?? 0;
}

/**
 * The probe's 8×8 grid covers the corridor from 0.14 to 0.66 of the canvas height (y up; row 0 at
 * the bottom). The active line (0.40 H from the top, under the key light) is in rows 6–7; the
 * upcoming lines below it in rows 2–6. Each role is measured against the worst case behind it.
 */
export const peaksOf = (pixels: Uint8Array): Peaks => ({
  active: peakL(pixels, 6, 7),
  zone: peakL(pixels, 2, 6),
});
