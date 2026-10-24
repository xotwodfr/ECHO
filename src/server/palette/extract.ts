// The package index pulls in modules with extensionless imports Node cannot load; the quantiser's
// own files are clean, and patches/ exports them.
import { QuantizerCelebi } from '@material/material-color-utilities/quantize/quantizer_celebi';
import {
  linearSrgbToOklab,
  oklabToLinearSrgb,
  oklchToOklab,
  srgbToLinear,
  type Vec3,
} from '../../shared/oklab.ts';

// Artwork palette extraction (VISUALIZER_SPEC.md §6.2): raw RGBA pixels of a 128×128 cover in, the
// palette roles of DESIGN_SYSTEM.md §3.3 out. Pure, so every rule is unit-tested on synthetic
// covers; `decode.ts` turns an image into the pixels.

export const PALETTE_VERSION = 1;

export interface Palette {
  room: string;
  accent: string;
  highlight: string;
  glow: string; // with its alpha (≤ 0.35)
  shadow: string;
  inkActive: string;
  source: 'art' | 'fallback';
  version: number;
}

type Lch = [number, number, number]; // OKLCH: L 0..1, C, h in degrees
interface Cluster {
  lch: Lch;
  lab: Vec3;
  share: number; // population fraction, 0..1
}

const BORDER = 0.03;
const ACHROMATIC_C = 0.04; // §6.2 step 5: an accent needs C ≥ 0.04

/** The achromatic fallback (tokens.css): Sodium on the neutral room. */
const FALLBACK = {
  room: [0.16, 0.006, 250],
  accent: lchOf(hexToLinear('#E3B26B')),
  highlight: [0.92, 0.04, 80],
  glow: [0.68, 0.1, 75],
  shadow: [0.08, 0.004, 250],
} satisfies Record<string, Lch>;

function hexToLinear(hex: string): Vec3 {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255)) as Vec3;
}

function lchOf(rgb: Vec3): Lch {
  const [L, a, b] = linearSrgbToOklab(rgb);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const inGamut = (rgb: Vec3) => rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6);

/** Reduces chroma at constant L and h until the colour is inside sRGB (binary search, 8 steps). */
export function gamutMap([L, C, h]: Lch): Lch {
  if (inGamut(oklabToLinearSrgb(oklchToOklab(L, C, h)))) return [L, C, h];
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinearSrgb(oklchToOklab(L, mid, h)))) lo = mid;
    else hi = mid;
  }
  return [L, lo, h];
}

/** §6.2 step 6: lightness clamped, chroma soft-kneed (`Cmax·tanh(C/Cmax)`), hue kept, gamut-mapped. */
function constrain([L, C, h]: Lch, box: { L: [number, number]; Cmax: number; Cmin?: number }): Lch {
  const knee = box.Cmax * Math.tanh(C / box.Cmax);
  return gamutMap([clamp(L, box.L[0], box.L[1]), Math.max(box.Cmin ?? 0, knee), h]);
}

const css = ([L, C, h]: Lch, alpha?: number) =>
  `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${h.toFixed(2)}${alpha === undefined ? '' : ` / ${alpha}`})`;

const dE = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Clusters of the cover, most populous first. Border and transparent pixels are dropped. */
export function clustersOf(rgba: Uint8Array | Buffer, width: number, height: number): Cluster[] {
  const bx = Math.round(width * BORDER);
  const by = Math.round(height * BORDER);
  const argb: number[] = [];
  for (let y = by; y < height - by; y++)
    for (let x = bx; x < width - bx; x++) {
      const i = (y * width + x) * 4;
      if ((rgba[i + 3] as number) < 128) continue;
      argb.push(
        (0xff << 24) |
          ((rgba[i] as number) << 16) |
          ((rgba[i + 1] as number) << 8) |
          (rgba[i + 2] as number),
      );
    }
  if (!argb.length) return [];
  // The quantiser's k-means seeds its first assignment from Math.random(), so the same cover could
  // give a slightly different palette each time. Seeded for the (synchronous) call: one cover, one
  // palette, on every server and every recompute.
  const random = Math.random;
  let seed = 0x42688;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  let counts: Map<number, number>;
  try {
    counts = QuantizerCelebi.quantize(argb, 24);
  } finally {
    Math.random = random;
  }
  const out: Cluster[] = [];
  for (const [c, n] of counts) {
    const rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) =>
      srgbToLinear(v / 255),
    ) as Vec3;
    out.push({ lch: lchOf(rgb), lab: linearSrgbToOklab(rgb), share: n / argb.length });
  }
  return out.sort((a, b) => b.share - a.share);
}

/** Near-white ink tinted toward the highlight (DESIGN_SYSTEM.md §3.4 rule 2). */
const inkFor = (highlight: Lch): Lch => [0.95, Math.min(0.012, 0.15 * highlight[1]), highlight[2]];

function build(
  roles: { room: Lch; accent: Lch; highlight: Lch; glow: Lch; shadow: Lch },
  source: Palette['source'],
): Palette {
  return {
    room: css(roles.room),
    accent: css(roles.accent),
    highlight: css(roles.highlight),
    glow: css(roles.glow, 0.35),
    shadow: css(roles.shadow),
    inkActive: css(inkFor(roles.highlight)),
    source,
    version: PALETTE_VERSION,
  };
}

export const fallbackPalette = (): Palette => build(FALLBACK, 'fallback');

/** §6.2 steps 5–9 on the clusters of one cover. */
export function paletteOf(clusters: Cluster[]): Palette {
  const dominant = clusters[0];
  const chromatic = clusters.filter((c) => c.lch[1] >= ACHROMATIC_C);
  if (!dominant || !chromatic.length) return fallbackPalette(); // step 7: no hue from noise

  // Accent: population^0.5 · C, skipping colours too close to the dominant one when a real
  // alternative (≥ 5%) exists.
  const far = chromatic.filter((c) => dE(c.lab, dominant.lab) >= 0.04);
  const pool = far.some((c) => c.share >= 0.05) ? far : chromatic;
  const accentC = pool.reduce((a, b) =>
    Math.sqrt(b.share) * b.lch[1] > Math.sqrt(a.share) * a.lch[1] ? b : a,
  );
  const accent = constrain(accentC.lch, { L: [0.7, 0.82], Cmax: 0.18, Cmin: 0.06 });

  const light = clusters
    .filter((c) => c.lch[1] > ACHROMATIC_C && c.share >= 0.02)
    .sort((a, b) => b.lch[0] - a.lch[0])[0];
  const highlight = constrain(light ? light.lch : [0.9, accentC.lch[1], accentC.lch[2]], {
    L: [0.86, 0.94],
    Cmax: 0.1,
  });

  // Room: the dominant colour pushed dark. A mostly white cover takes its darkest meaningful
  // colour instead, or the neutral room in the cover's hue (step 8): the room is never light.
  let roomFrom = dominant.lch;
  if (dominant.lch[0] > 0.85) {
    const dark = clusters.filter((c) => c.share >= 0.03).sort((a, b) => a.lch[0] - b.lch[0])[0];
    roomFrom =
      dark && dark.lch[0] < 0.85
        ? dark.lch
        : [FALLBACK.room[0], Math.min(0.03, dominant.lch[1]), dominant.lch[2]];
  }
  const room = constrain(roomFrom, { L: [0.12, 0.24], Cmax: 0.1 });
  const glow = constrain(accentC.lch, { L: [0.6, 0.72], Cmax: 0.14 });
  const shadow = constrain(room, { L: [0.06, 0.1], Cmax: 0.1 });
  return build({ room, accent, highlight, glow, shadow }, 'art');
}
