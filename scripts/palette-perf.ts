// Palette extraction time per cover (VIS-03 budget: 150 ms on the OptiPlex, fetch included).
// Run on the target: node scripts/palette-perf.ts
import sharp from 'sharp';
import { covers, SIZE } from '../src/server/palette/covers.ts';
import { decodeCover } from '../src/server/palette/decode.ts';
import { clustersOf, paletteOf } from '../src/server/palette/extract.ts';
// A realistic cover: 1000×1000 JPEG (Navidrome serves size=256, so this is the pessimistic case).
const jpegs = await Promise.all(covers.map((c) => sharp(c.rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).resize(1000, 1000).jpeg({ quality: 90 }).toBuffer()));
const times: number[] = [];
for (let r = 0; r < 3; r++) for (const j of jpegs) {
  const t0 = performance.now();
  const { rgba, width, height } = await decodeCover(j);
  paletteOf(clustersOf(rgba, width, height));
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
console.log(`n=${times.length} median=${times[times.length >> 1]?.toFixed(1)}ms p95=${times[Math.floor(times.length * 0.95)]?.toFixed(1)}ms max=${times.at(-1)?.toFixed(1)}ms`);
