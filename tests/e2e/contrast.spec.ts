import { expect, type Page, test } from '@playwright/test';
import { lyricFixtures } from '../../src/client/fixtures/lyrics.ts';
import { buildTimeline } from '../../src/client/stage/lyrics/timing.ts';
import { covers } from '../../src/server/palette/covers.ts';
import type { LyricLine, LyricsDoc } from '../../src/shared/types.ts';

// VIS-05 (DESIGN_SYSTEM.md §3.4): with every fixture cover's palette, a deterministic lyric frame
// is drawn with the lyric floors met: the contrast solver darkens the room until they hold. Needs
// WebGL 2 (the probe reads the room), so Chromium only.

interface Diag {
  peaks: { active: number; zone: number };
  report: { active: number; lit: number; zone: number[] };
  solve: { exposure: number; scrim: number };
}

const tl = buildTimeline(lyricFixtures['ballad-word'] as LyricsDoc);
const line = tl.lines[2] as LyricLine;
const MID = Math.round((line.start + (line.end ?? line.start)) / 2);

async function diag(page: Page, palette: string) {
  await page.goto(`/?frame=${MID}&fixture=ballad-word&palette=${palette}`);
  await expect(page.locator('.stage')).toHaveAttribute('data-renderer', 'webgl', {
    timeout: 15_000,
  });
  const read = () =>
    page.evaluate(() => (window as unknown as { __echoContrast?: Diag }).__echoContrast ?? null);
  await expect.poll(read).not.toBeNull();
  // Settled: the palette has landed and the solver has stopped moving.
  let prev = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await read());
        const same = now === prev;
        prev = now;
        return same;
      },
      { intervals: [300] },
    )
    .toBe(true);
  return (await read()) as Diag;
}

test.describe('contrast floors on every fixture palette (VIS-05)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'needs WebGL 2');

  for (const c of covers)
    test(c.name, async ({ page }) => {
      const d = await diag(page, `fixture:${c.name}`);
      expect(d.report.active).toBeGreaterThanOrEqual(7);
      expect(d.report.lit).toBeGreaterThanOrEqual(4.5);
      for (const z of d.report.zone) expect(z).toBeGreaterThanOrEqual(3); // +1 … +3
      expect(d.solve.scrim).toBe(0); // exposure alone is enough on every fixture palette
    });
});
