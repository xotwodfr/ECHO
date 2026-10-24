import { expect, test } from '@playwright/test';

// A11Y-08 (VISUALIZER_SPEC.md §7.3): Reverb at the default intensity (Expressive) on the stress
// fixture, a 140 BPM techno kick with full-band transients (the rap-word guide track's Features).
// 10 s of rendered frames, sampled at 30 fps: no region of a 4×4 grid changes its mean relative
// luminance by more than 0.08 within any 333 ms window. Runs in its own Chromium project
// (playwright.config.ts) after the other specs.

test.setTimeout(60_000);

test('Reverb on the stress fixture stays under the flash limit', async ({ page }) => {
  await page.goto('/library/album/al-guide');
  await page.getByRole('button', { name: 'Play rap-word', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Listen' })
    .click();
  const stage = page.locator('.stage');
  await expect(stage).toHaveAttribute('data-renderer', 'webgl', { timeout: 15_000 });
  await expect(stage).toHaveAttribute('data-mode', 'reverb', { timeout: 5000 });
  await page.waitForTimeout(1500); // past the first transients and the palette fade

  await page.evaluate(() => Object.assign(window, { __echoLuma: [] }));
  await page.waitForTimeout(10_000);
  const frames = await page.evaluate(
    () => (window as unknown as { __echoLuma: { t: number; grid: number[] }[] }).__echoLuma,
  );
  // Resample at 30 fps.
  const t0 = frames[0]?.t ?? 0;
  const at30: number[][] = [];
  for (let k = 0, i = 0; k < 300; k++) {
    const t = t0 + (k * 1000) / 30;
    while (i + 1 < frames.length && (frames[i + 1]?.t ?? 0) <= t) i++;
    at30.push(frames[i]?.grid ?? []);
  }
  // Software WebGL (CI, this host) draws ~8 fps with the readback; the limit is per time, not frame.
  expect(frames.length).toBeGreaterThan(25); // it really ran (fewer under parallel load)
  let worst = 0;
  for (let r = 0; r < 16; r++)
    for (let a = 0; a < at30.length; a++)
      for (
        let b = a + 1;
        b < at30.length && b - a <= 10;
        b++ // 10 frames at 30 fps = 333 ms
      )
        worst = Math.max(worst, Math.abs((at30[b]?.[r] ?? 0) - (at30[a]?.[r] ?? 0)));
  console.log(`A11Y-08 worst regional change in 333 ms: ${worst.toFixed(4)}`);
  expect(worst).toBeLessThanOrEqual(0.08);
  // And something moved: the rings and breathing are there.
  let moved = 0;
  for (let r = 0; r < 16; r++)
    moved = Math.max(
      moved,
      Math.max(...at30.map((g) => g[r] ?? 0)) - Math.min(...at30.map((g) => g[r] ?? 0)),
    );
  expect(moved).toBeGreaterThan(0.0005);
});
