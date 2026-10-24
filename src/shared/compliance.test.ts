import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// SP-05 (PLAYBACK_ARCHITECTURE.md §4.5, §4.6; VISUALIZER_SPEC.md §2.3): no Audio Features,
// Audio Analysis or Recommendations calls, and no audio capture APIs, anywhere in ECHO's code.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
  });
}

const FORBIDDEN = [
  /\/audio-features\b/,
  /\/audio-analysis\b/,
  /\/recommendations\b/,
  /\/related-artists\b/,
  /\bgetDisplayMedia\b/,
  /\bgetUserMedia\b/,
];

describe('SP-05: no forbidden Spotify endpoints or audio capture', () => {
  it('scans src/ and scripts/', () => {
    const hits: string[] = [];
    const all = [...files('src'), ...files('scripts')];
    expect(all.length).toBeGreaterThan(50);
    for (const f of all) {
      const text = readFileSync(f, 'utf8');
      for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${f}: ${re}`);
    }
    expect(hits).toEqual([]);
  });
});
