import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guideTone, wav } from '../src/client/fixtures/guide-tone.ts';
import { lyricFixtures } from '../src/client/fixtures/lyrics.ts';

// Writes one guide-tone WAV per lyric fixture, for the M3 listening test:
//   node scripts/guide-tones.ts [out-dir]        (default test-results/guide-tones, not committed)

const RATE = 16_000;
const out = process.argv[2] ?? 'test-results/guide-tones';
mkdirSync(out, { recursive: true });
for (const [name, doc] of Object.entries(lyricFixtures)) {
  const path = join(out, `${name}.wav`);
  writeFileSync(path, wav(guideTone(doc, RATE), RATE));
  console.log(`wrote ${path}`);
}
