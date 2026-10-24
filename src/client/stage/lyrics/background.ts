import { LYRICS } from './lyricsConfig.ts';

// The background field (LYRICS_EXPERIENCE.md §8): the rest of the song floating around the
// listener. Everything here is a pure function of the track's seed, the line index and time, so the
// same song always arranges the same way, and a seek re-homes lines deterministically.

const B = LYRICS.background;
const Z = LYRICS.zone;
const TOP_FADE_H = 0.08; // lines that rise past 0.08 H fade out and re-home at the bottom
const FADE_S = 1.5;
const LONG_RANGE_MS = 60_000;
const CORRIDOR_Z = 0.85;
export const CORRIDOR_OPACITY = 0.1;

/** FNV-1a: a stable 32-bit seed from a track key. */
export function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: a small seeded PRNG in [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Home positions: seeded dart throwing (Poisson disc) over the stage, centres at least 0.16 H
 * apart, at most `max` of them.
 */
export function homes(seed: number, W: number, H: number, max = 40): Point[] {
  const r = rng(seed);
  const d = B.minDist * H;
  const out: Point[] = [];
  for (let tries = 0; tries < 3000 && out.length < max; tries++) {
    const p = { x: (0.06 + 0.88 * r()) * W, y: (0.1 + 0.78 * r()) * H };
    if (out.every((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 >= d * d)) out.push(p);
  }
  return out;
}

/** Depth by time distance (§8.2): within a minute near, further out deepest. */
export const depthAt = (start: number, t: number) =>
  Z.zBackground + (1 - Z.zBackground) * Math.min(1, Math.max(0, (start - t) / LONG_RANGE_MS));

/** Blur bucket (§8.2): B1 [0.78, 0.86), B2 [0.86, 0.94), B3 [0.94, 1]. */
export const bucketOf = (z: number) => (z < 0.86 ? 0 : z < 0.94 ? 1 : 2);

interface Path {
  P: [number, number, number, number, number]; // P₁…P₄ in 23–47 s, P₅ in 9–17 s
  theta: [number, number, number, number, number];
}

function pathOf(seed: number, line: number): Path {
  const r = rng(seed ^ Math.imul(line + 1, 0x9e3779b1));
  const p = () => 23 + 24 * r();
  const th = () => 2 * Math.PI * r();
  return { P: [p(), p(), p(), p(), 9 + 8 * r()], theta: [th(), th(), th(), th(), th()] };
}

export interface Placement {
  x: number; // centre, CSS px
  y: number;
  z: number;
  opacity: number; // o(z) with breathing, re-home fades and corridor caps already applied
  bucket: number; // from the depth when the line was homed
  home: number; // how many times the line has re-homed (for tests and bucket changes)
}

/** §12.3: breathing amplitude (quiet passages halve it) and percussion kicks per bucket, px. */
export interface BeatMod {
  breathe: number;
  kick: readonly number[];
}

export interface Corridor {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const TAU = 2 * Math.PI;
const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/**
 * Where background line `line` (starting at `start`) sits at song time `t` (ms). `driftS` is the
 * background clock in seconds (the Stage's pool time, slowed while paused and by passage), which
 * runs the wandering paths; the slow rise follows song time so it is reproducible. `opacityAt` is the depth function o(z) (§4.1).
 */
export function place(
  seed: number,
  pts: readonly Point[],
  line: number,
  start: number,
  t: number,
  driftS: number,
  W: number,
  H: number,
  box: { w: number; h: number },
  corridor: Corridor,
  opacityAt: (z: number) => number,
  scaleAt: (z: number) => number,
  beat: BeatMod = { breathe: 1, kick: [0, 0, 0] },
): Placement {
  const n = pts.length;
  if (n === 0) return { x: W / 2, y: H / 2, z: 1, opacity: 0, bucket: 2, home: 0 };
  const rise = B.rise * H; // px per second of song time
  const ts = Math.max(0, t) / 1000;
  // Walk the line's homes: each lasts until it has risen past 0.08 H, then fades for 1.5 s.
  let k = 0;
  let homeAt = 0;
  let p = pts[line % n] as Point;
  for (;;) {
    const life = Math.max(0, (p.y - TOP_FADE_H * H) / rise) + FADE_S;
    if (ts < homeAt + life || k > 64) break;
    homeAt += life;
    k++;
    p = nextBottomHome(pts, line, k, H);
  }
  const age = ts - homeAt;
  const bucket = bucketOf(depthAt(start, homeAt * 1000));
  // A percussion kick moves the line along its own seeded direction, before the corridor caps so
  // it cannot carry a line in.
  const dir = TAU * rng(seed ^ Math.imul(line + 1, 0x85ebca6b))();
  const kick = beat.kick[bucket] ?? 0;
  const y0 = p.y - rise * age;
  const life = Math.max(0, (p.y - TOP_FADE_H * H) / rise);
  const fadeOut = 1 - smooth((age - life) / FADE_S);
  const fadeIn = k === 0 ? 1 : smooth(age / FADE_S);

  const z = depthAt(start, t);
  const amp = 1 - (0.4 * (z - Z.zBackground)) / (1 - Z.zBackground);
  const { P, theta } = pathOf(seed, line);
  const s = (i: number, scale = 1) =>
    Math.sin((TAU * driftS) / (P[i] as number) + (theta[i] as number)) * scale;
  const cam = sway(driftS, W, H, z);
  // Lines are wide: the centre is kept far enough in that the whole scaled box stays on stage.
  const half = Math.min(W / 2, (box.w * scaleAt(z)) / 2 + 0.02 * W);
  const x = Math.min(
    W - half,
    Math.max(half, p.x + B.ampX * W * amp * (s(0) + s(1, 0.5)) + cam.x + Math.cos(dir) * kick),
  );
  const y = y0 + B.ampY * H * amp * (s(2) + s(3, 0.5)) + cam.y + Math.sin(dir) * kick;
  const breath = 1 - 0.25 * beat.breathe * (0.5 - 0.5 * s(4)); // 0.75…1; quiet passages halve it
  let opacity = opacityAt(z) * breath * fadeIn * fadeOut;

  // The reading corridor (§3.2): a line may cross it only at z ≥ 0.85 and opacity ≤ 0.10. The cap
  // eases in over 0.02 H outside the corridor, so it is complete at the edge and nothing pops.
  const sc = scaleAt(z);
  const m = 0.02 * H;
  const hw = (box.w * sc) / 2;
  const hh = (box.h * sc) / 2;
  const ox = Math.min(x + hw, corridor.x1 + m) - Math.max(x - hw, corridor.x0 - m);
  const oy = Math.min(y + hh, corridor.y1 + m) - Math.max(y - hh, corridor.y0 - m);
  let zz = z;
  if (ox > 0 && oy > 0) {
    const k2 = smooth(Math.min(ox, oy) / m);
    zz = z + (Math.max(z, CORRIDOR_Z) - z) * k2;
    opacity += (Math.min(opacity, CORRIDOR_OPACITY, opacityAt(zz)) - opacity) * k2;
  }
  return { x, y, z: zz, opacity, bucket, home: k };
}

function nextBottomHome(pts: readonly Point[], line: number, k: number, H: number): Point {
  const n = pts.length;
  for (let j = 0; j < n; j++) {
    const p = pts[(line + k * 7 + j) % n] as Point;
    if (p.y > H / 2) return p;
  }
  return pts[(line + k * 7) % n] as Point;
}

/** Camera sway shared by the field (§8.4); each line moves by `cam × (1 − z) × 2.2`. */
export function sway(driftS: number, W: number, H: number, z: number) {
  const k = (1 - z) * 2.2;
  return {
    x: 0.006 * W * Math.sin((TAU * driftS) / 61) * k,
    y: 0.004 * H * Math.sin((TAU * driftS) / 47) * k,
  };
}
