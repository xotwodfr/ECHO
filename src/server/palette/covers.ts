import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { linearToSrgb, oklabToLinearSrgb, oklchToOklab } from '../../shared/oklab.ts';

// The 30 fixture covers of IMPLEMENTATION_PLAN.md M4 task 4, generated (no artwork is committed):
// 128×128 RGBA, covering the cases VISUALIZER_SPEC.md §6.2 names — saturated, two-tone, gradients,
// pastel, neon, near-white, achromatic, framed and transparent covers. Seeded, so reproducible.

export const SIZE = 128;
type Lch = [number, number, number];

export interface Cover {
  name: string;
  kind: 'chromatic' | 'achromatic' | 'white' | 'neon';
  rgba: Uint8Array;
}

const bytes = (lch: Lch) =>
  oklabToLinearSrgb(oklchToOklab(...lch)).map((c) =>
    Math.round(linearToSrgb(Math.min(1, Math.max(0, c))) * 255),
  );

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Paints a cover pixel by pixel: `at(x, y)` in 0..1 returns an OKLCH colour, or null (transparent). */
function paint(at: (x: number, y: number, r: () => number) => Lch | null, seed = 1) {
  const r = rng(seed);
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const c = at(x / (SIZE - 1), y / (SIZE - 1), r);
      const i = (y * SIZE + x) * 4;
      if (!c) continue;
      const [R, G, B] = bytes(c);
      out[i] = R as number;
      out[i + 1] = G as number;
      out[i + 2] = B as number;
      out[i + 3] = 255;
    }
  return out;
}

const solid = (lch: Lch) => () => lch;
const disc = (bg: Lch, fg: Lch, radius: number) => (x: number, y: number) =>
  Math.hypot(x - 0.5, y - 0.5) < radius ? fg : bg;
const grad = (a: Lch, b: Lch) => (_x: number, y: number) =>
  [a[0] + (b[0] - a[0]) * y, a[1] + (b[1] - a[1]) * y, a[2] + (b[2] - a[2]) * y] as Lch;
const noisy = (base: Lch, amp: number) => (_x: number, _y: number, r: () => number) =>
  [base[0] + (r() - 0.5) * amp, base[1], base[2]] as Lch;

const C = (
  name: string,
  kind: Cover['kind'],
  at: Parameters<typeof paint>[0],
  seed?: number,
): Cover => ({
  name,
  kind,
  rgba: paint(at, seed),
});

export const covers: Cover[] = [
  // Saturated single colours across the hue circle.
  ...[25, 70, 110, 150, 200, 250, 290, 330].map((h, i) =>
    C(`solid-${h}`, 'chromatic', solid([0.55 + (i % 3) * 0.08, 0.16, h])),
  ),
  // Dark ground with a bright subject.
  C('night-sun', 'chromatic', disc([0.18, 0.03, 260], [0.8, 0.16, 70], 0.25)),
  C('forest-moon', 'chromatic', disc([0.25, 0.06, 150], [0.9, 0.05, 95], 0.2)),
  C('red-on-black', 'chromatic', disc([0.12, 0.005, 0], [0.6, 0.2, 28], 0.3)),
  C('teal-on-navy', 'chromatic', disc([0.2, 0.08, 265], [0.75, 0.12, 190], 0.28)),
  C('small-accent', 'chromatic', disc([0.3, 0.02, 60], [0.7, 0.18, 340], 0.08)),
  C('rust-on-cream', 'chromatic', disc([0.88, 0.03, 85], [0.55, 0.14, 40], 0.3)),
  // Gradients and pastels.
  C('dusk', 'chromatic', grad([0.35, 0.12, 300], [0.75, 0.14, 50])),
  C('fire', 'chromatic', grad([0.4, 0.2, 30], [0.85, 0.16, 90])),
  C('pastel-pink', 'chromatic', solid([0.86, 0.06, 0])),
  C('pastel-mint', 'chromatic', noisy([0.88, 0.05, 160], 0.06), 3),
  // Neon: chroma far above the boxes.
  C('neon-green', 'neon', solid([0.87, 0.29, 142])),
  C('neon-magenta', 'neon', disc([0.15, 0.05, 300], [0.7, 0.32, 328], 0.35)),
  C('neon-blue', 'neon', grad([0.3, 0.2, 264], [0.6, 0.3, 264])),
  // Mostly white.
  C('white-plain', 'white', solid([0.98, 0, 0])),
  C('white-dark-type', 'white', (x, y) =>
    y > 0.7 && y < 0.8 && x > 0.2 && x < 0.8 ? [0.2, 0.02, 250] : [0.96, 0.01, 90],
  ),
  C('white-blue-type', 'white', (_x, y) =>
    y > 0.4 && y < 0.62 ? [0.45, 0.15, 260] : [0.97, 0.005, 250],
  ),
  // Achromatic.
  C('black', 'achromatic', solid([0.05, 0, 0])),
  C('grey-gradient', 'achromatic', grad([0.2, 0, 0], [0.8, 0, 0])),
  C('bw-photo', 'achromatic', noisy([0.45, 0.004, 80], 0.6), 7),
  C('almost-grey', 'achromatic', noisy([0.5, 0.015, 40], 0.2), 9),
  // A coloured frame around a grey cover, and a cover with transparent corners.
  C('framed-grey', 'achromatic', (x, y) =>
    x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98 ? [0.6, 0.2, 30] : [0.4, 0.005, 0],
  ),
  C('round-badge', 'chromatic', (x, y) =>
    Math.hypot(x - 0.5, y - 0.5) > 0.5 ? null : [0.5, 0.15, 210],
  ),
];

/** A fixture cover as a PNG, so the endpoint runs the whole decode path. */
export async function fixtureCover(name: string): Promise<Buffer | null> {
  const c = covers.find((x) => x.name === name);
  if (!c) return null;
  return sharp(c.rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * Development only: the fixture library's albums (src/client/fixtures/library.ts) have SVG covers
 * in the client source, which the image does not contain. Lets the dev shell show real palettes
 * before Navidrome covers arrive (M5).
 */
const LIBRARY: Record<string, string> = {
  'navidrome:al-harbour': 'harbour-lights',
  'navidrome:al-paper': 'paper-satellites',
  'navidrome:al-glass': 'glass-weather',
  'navidrome:al-exposure': 'long-exposure',
  'navidrome:al-signal': 'signal-noise',
};

export async function libraryCover(albumKey: string): Promise<Buffer | null> {
  const name = LIBRARY[albumKey];
  if (!name) return null;
  return readFile(`src/client/fixtures/covers/${name}.svg`).catch(() => null);
}
