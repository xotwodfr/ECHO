import { test } from '@playwright/test';
import { lyricFixtures } from '../../src/client/fixtures/lyrics.ts';
import { buildTimeline } from '../../src/client/stage/lyrics/timing.ts';
import type { LyricLine } from '../../src/shared/types.ts';

// Design-review screenshots (IMPLEMENTATION_PLAN.md M3 task 12): every timed fixture at five
// moments, at 1440×900, as deterministic frames. Not a test: run on demand with
//   SHOTS=1 pnpm exec playwright test review-shots --project=chromium
// and find the PNGs in test-results/review-shots/ (or $SHOTS_DIR).

const out = process.env.SHOTS_DIR ?? 'test-results/review-shots';
const mid = (l: LyricLine) => (l.start + (l.end ?? l.start + 2000)) / 2;

test.skip(!process.env.SHOTS, 'run with SHOTS=1');
test.use({ viewport: { width: 1440, height: 900 } });

for (const [name, doc] of Object.entries(lyricFixtures)) {
  if (doc.sync === 'none') continue;
  test(name, async ({ page }) => {
    const tl = buildTimeline(doc);
    const ls = tl.lines;
    const at = (k: number) =>
      ls[Math.min(ls.length - 1, Math.floor(k * (ls.length - 1)))] as LyricLine;
    const moments: [string, number][] = [
      ['1-intro', Math.max(0, (tl.handovers[0] ?? 0) - 800)],
      ['2-early', mid(at(0.1))],
      ['3-middle', mid(at(0.45))],
      ['4-late', mid(at(0.8))],
      ['5-last', mid(ls.at(-1) as LyricLine)],
    ];
    for (const [label, ms] of moments) {
      await page.goto(`/?frame=${Math.round(ms)}&fixture=${name}`);
      await page.locator('.ly-field .ly-line').first().waitFor({ state: 'attached' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/${name}-${label}.png` });
    }
  });
}
