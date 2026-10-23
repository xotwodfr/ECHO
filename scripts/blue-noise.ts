import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

// Blue-noise dither textures (VISUALIZER_SPEC.md §5.2, §9): a 64×64 tile for the composite's
// ±1 LSB dither and a 128×128 tile for the CSS fallback room. Void-and-cluster (Ulichney 1993) with
// a fixed seed, so the committed PNGs are reproducible:
//   node scripts/blue-noise.ts

/** Ranks 0..n²−1 of a blue-noise dither array, row-major. */
export function voidAndCluster(n: number, seed = 1, sigma = 1.5): Uint32Array {
  const size = n * n;
  // Energy contributed by a point at (0,0) to (x,y) on the torus.
  const lut = new Float64Array(size);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = Math.min(x, n - x);
      const dy = Math.min(y, n - y);
      lut[y * n + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  const energy = new Float64Array(size);
  const bits = new Uint8Array(size);
  const toggle = (i: number, on: boolean) => {
    bits[i] = on ? 1 : 0;
    const ix = i % n;
    const iy = (i / n) | 0;
    const s = on ? 1 : -1;
    for (let y = 0; y < n; y++) {
      const row = ((y - iy + n) % n) * n;
      for (let x = 0; x < n; x++) {
        const at = y * n + x;
        energy[at] = (energy[at] as number) + s * (lut[row + ((x - ix + n) % n)] as number);
      }
    }
  };
  const extreme = (want: 0 | 1, max: boolean) => {
    let best = -1;
    for (let i = 0; i < size; i++)
      if (bits[i] === want) {
        const e = energy[i] as number;
        const b = energy[best] as number;
        if (best < 0 || (max ? e > b : e < b)) best = i;
      }
    return best;
  };

  // Seeded initial pattern (~10% ones), relaxed until the tightest cluster is the largest void.
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ones = Math.round(size * 0.1);
  for (let placed = 0; placed < ones; ) {
    const i = Math.floor(random() * size);
    if (!bits[i]) {
      toggle(i, true);
      placed++;
    }
  }
  for (;;) {
    const cluster = extreme(1, true);
    toggle(cluster, false);
    const voidAt = extreme(0, false);
    toggle(voidAt, true);
    if (voidAt === cluster) break;
  }

  const rank = new Uint32Array(size);
  const initial = bits.slice();
  const initialEnergy = energy.slice();
  // Phase 1: remove the tightest clusters, ranking downwards.
  for (let r = ones - 1; r >= 0; r--) {
    const i = extreme(1, true);
    toggle(i, false);
    rank[i] = r;
  }
  // Phase 2: from the initial pattern, fill the largest voids, ranking upwards.
  bits.set(initial);
  energy.set(initialEnergy);
  for (let r = ones; r < size; r++) {
    const i = extreme(0, false);
    toggle(i, true);
    rank[i] = r;
  }
  return rank;
}

/** An 8-bit greyscale PNG. */
export function greyPng(width: number, pixels: Uint8Array): Buffer {
  const height = pixels.length / width;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (import.meta.main) {
  for (const n of [64, 128]) {
    const rank = voidAndCluster(n);
    const px = Uint8Array.from(rank, (r) => Math.floor((r * 256) / (n * n)));
    const path = `src/client/stage/blue-noise-${n}.png`;
    writeFileSync(path, greyPng(n, px));
    console.log(`wrote ${path}`);
  }
}
