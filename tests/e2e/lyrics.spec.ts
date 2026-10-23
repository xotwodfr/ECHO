import { expect, type Page, test } from '@playwright/test';
import { lyricFixtures } from '../../src/client/fixtures/lyrics.ts';
import { FieldModel, type LineBox, washAt } from '../../src/client/stage/lyrics/model.ts';
import { buildTimeline } from '../../src/client/stage/lyrics/timing.ts';
import type { LyricLine, LyricsDoc } from '../../src/shared/types.ts';

// M3 tasks 6–7: the lyric field in the browser, on its real layout (LYRICS_EXPERIENCE.md §3–§9).
// Deterministic frames (`?frame=<ms>&fixture=<lyric fixture>`) for positions and states; real-time
// playback of the guide tracks for pause and scrub. The field runs on the CSS room too, so all of
// this runs in Firefox without WebGL.

const DOCK = 88;
const doc = (name: string) => lyricFixtures[name] as LyricsDoc;
const timeline = (name: string) => buildTimeline(doc(name));

interface LineInfo {
  text: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  cy: number;
  opacity: number;
  blur: number;
  parent: string;
}

/** Every line element the field shows, with its box and styles. */
async function lines(page: Page): Promise<LineInfo[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.ly-line')].map((l) => {
      const r = l.getBoundingClientRect();
      return {
        text: l.querySelector('.ly-lead')?.textContent ?? '',
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        cy: r.top + r.height / 2,
        opacity: Number(l.style.opacity || 1),
        blur: Number(/blur\(([\d.]+)px\)/.exec(l.style.filter)?.[1] ?? 0),
        parent: l.parentElement?.className ?? '',
      };
    }),
  );
}

const main = (ls: LineInfo[]) => ls.filter((l) => l.parent === 'ly-main' && l.opacity > 0.02);

async function frame(page: Page, name: string, ms: number) {
  await page.goto(`/?frame=${Math.round(ms)}&fixture=${name}`);
  await expect(page.locator('.ly-field .ly-line').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
}

test.describe('deterministic frames', () => {
  test('ballad: the active line at 0.40 H, the zone below it fading with distance (LYR-02, LYR-03)', async ({
    page,
  }) => {
    const tl = timeline('ballad-word');
    const active = tl.lines[2] as LyricLine;
    await frame(page, 'ballad-word', (active.start + (active.end ?? active.start)) / 2);
    const vp = page.viewportSize() as { width: number; height: number };
    const H = vp.height - DOCK;
    const ls = main(await lines(page));
    const a = ls.find((l) => l.text === active.text);
    expect(a).toBeDefined();
    expect(Math.abs((a?.cy ?? 0) - 0.4 * H)).toBeLessThanOrEqual(2);
    expect(a?.opacity).toBe(1);
    const below = ls.filter((l) => l.cy > (a?.cy ?? 0)).sort((x, y) => x.cy - y.cy);
    expect(below.length).toBeGreaterThanOrEqual(2);
    expect(below[0]?.top).toBeGreaterThanOrEqual((a?.bottom ?? 0) + 0.02 * H - 1);
    for (let k = 1; k < below.length; k++) {
      const [p, q] = [below[k - 1] as LineInfo, below[k] as LineInfo];
      if (q.cy - p.cy < 1) continue; // +3 waiting behind +2 (§4.3 overflow)
      expect(q.opacity).toBeLessThan(p.opacity);
      expect(q.blur).toBeGreaterThan(p.blur);
    }
    // No line of the zone is cut by the stage edges.
    for (const l of ls) {
      expect(l.left).toBeGreaterThanOrEqual(0);
      expect(l.right).toBeLessThanOrEqual(vp.width);
    }
  });

  test('word sweep: earlier words lit, the sweeping word at its time, later words unlit (LYR-07)', async ({
    page,
  }) => {
    const line = timeline('accents-word').lines[1] as LyricLine;
    const words = line.words ?? [];
    const k = Math.floor(words.length / 2);
    const w = words[k];
    if (!w) throw new Error('fixture');
    const t = Math.round(w.start + 0.4 * (w.end - w.start));
    await frame(page, 'accents-word', t);
    const states = await page.evaluate((text) => {
      const l = [...document.querySelectorAll('.ly-main .ly-line')].find(
        (x) => x.querySelector('.ly-lead')?.textContent === text,
      );
      return [...(l?.querySelectorAll<HTMLElement>('.ly-lead .ly-w') ?? [])].map((s) => ({
        cls: s.className,
        p:
          s.style.getPropertyValue('--p') ||
          [...s.querySelectorAll<HTMLElement>('.ly-g')]
            .map((g) => g.style.getPropertyValue('--p'))
            .join(' '),
      }));
    }, line.text);
    expect(states).toHaveLength(words.length);
    states.forEach((s, j) => {
      if (j < k) expect(s.cls).toContain('lit');
      if (j > k) expect(s.cls).not.toMatch(/lit|sweep/);
    });
    expect(states[k]?.cls).toContain('sweep');
    if (!states[k]?.cls.includes('ly-emph')) {
      const p = Number.parseFloat(states[k]?.p ?? '');
      const want = ((t - w.start) / Math.max(60, w.end - w.start)) * 100;
      expect(Math.abs(p - want)).toBeLessThanOrEqual(1);
    }
  });

  test('line-timed: one wash over the whole line for 420 ms, no per-word sweep (LYR-13)', async ({
    page,
  }) => {
    const line = timeline('pop-line').lines[1] as LyricLine;
    await frame(page, 'pop-line', line.start + 120);
    const wash = page.locator('.ly-main .ly-line').filter({ hasText: line.text }).locator('.ly-w');
    await expect(wash).toHaveCount(1);
    await expect(wash).toHaveClass(/ly-wash/);
    await expect(wash).toHaveClass(/sweep/);
    const p = Number.parseFloat(await wash.evaluate((s) => s.style.getPropertyValue('--p')));
    expect(p).toBeCloseTo(washAt(line, line.start + 120) * 100, 0);
    await frame(page, 'pop-line', line.start + 430);
    const done = page.locator('.ly-main .ly-line').filter({ hasText: line.text }).locator('.ly-w');
    await expect(done).toHaveClass(/lit/);
  });

  test('interlude dots in the intro, gone before the first hand-over (LYR-21)', async ({
    page,
  }) => {
    const tl = timeline('intro-outro');
    await frame(page, 'intro-outro', 10_000);
    await expect(page.locator('.ly-dots')).toHaveCSS('opacity', '1');
    await expect(page.locator('.ly-dot')).toHaveCount(3);
    await frame(page, 'intro-outro', (tl.handovers[0] as number) - 200);
    await expect(page.locator('.ly-dots')).toHaveCSS('opacity', '0');
  });

  test('duet: each voice on its side, backing vocals at 0.62× under the lead (LYR-23)', async ({
    page,
  }) => {
    const tl = timeline('duet-word');
    const vp = page.viewportSize() as { width: number; height: number };
    for (const i of [1, 3, 8]) {
      const l = tl.lines[i] as LyricLine;
      await frame(page, 'duet-word', l.start + 200);
      const box = await page.evaluate((text) => {
        const el = [...document.querySelectorAll<HTMLElement>('.ly-main .ly-line')].find(
          (x) => x.querySelector('.ly-lead')?.textContent === text,
        );
        const r = el?.getBoundingClientRect();
        return { left: r?.left ?? -1, right: r?.right ?? -1, side: el?.dataset.side };
      }, l.text);
      if (l.oppositeAligned) {
        expect(box.side).toBe('right');
        expect(Math.abs(box.right - 0.82 * vp.width)).toBeLessThanOrEqual(2);
      } else {
        expect(box.side).toBe('left');
        expect(Math.abs(box.left - 0.18 * vp.width)).toBeLessThanOrEqual(2);
      }
    }
    const withBg = tl.lines.findIndex((l) => l.background?.length);
    await frame(page, 'duet-word', (tl.lines[withBg] as LyricLine).start + 200);
    const sizes = await page.evaluate(() => {
      const bg = document.querySelector<HTMLElement>('.ly-main .ly-bg');
      const lead = bg?.parentElement?.querySelector<HTMLElement>('.ly-lead');
      const lb = lead?.getBoundingClientRect();
      const bb = bg?.getBoundingClientRect();
      return {
        bg: Number.parseFloat(getComputedStyle(bg as Element).fontSize),
        lead: Number.parseFloat(getComputedStyle(lead as Element).fontSize),
        below: (bb?.top ?? 0) >= (lb?.bottom ?? 1) - 1,
      };
    });
    expect(sizes.bg / sizes.lead).toBeCloseTo(0.62, 2);
    expect(sizes.below).toBe(true);
  });

  test('RTL sweeps from the right; CJK sweeps per character with no tracking (LYR-24)', async ({
    page,
  }) => {
    const rtl = timeline('rtl-line').lines[0] as LyricLine;
    await frame(page, 'rtl-line', rtl.start + 150);
    const r = page.locator('.ly-main .ly-line[dir="rtl"] .ly-wash.sweep').first();
    expect(await r.evaluate((s) => getComputedStyle(s).backgroundImage)).toMatch(
      /^linear-gradient\((270deg|to left)/,
    );

    const cjk = timeline('cjk-word').lines[0] as LyricLine;
    const w = cjk.words?.[2];
    if (!w) throw new Error('fixture');
    await frame(page, 'cjk-word', (w.start + w.end) / 2);
    const line = page.locator('.ly-main .ly-line[data-cjk]').filter({ hasText: cjk.text }).first();
    await expect(line.locator('.ly-lead .ly-w')).toHaveCount(cjk.words?.length ?? 0);
    expect(await line.evaluate((el) => getComputedStyle(el).letterSpacing)).toMatch(
      /^(0px|normal)$/,
    );
    await expect(line.locator('.ly-lead .ly-w').nth(2)).toHaveClass(/sweep/);
  });
});

test.describe('layout on real measurements', () => {
  test('long lines at 1024×640: at most 3 rows, the zone above 0.86 H (LYR-27)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    const tl = timeline('long-lines');
    await frame(page, 'long-lines', (tl.lines[0] as LyricLine).start + 100);
    const info = await page.evaluate(
      () =>
        (
          window as unknown as {
            __echoLyrics: { fontPx: number; lines: { rows: number; fit: { size: number } }[] };
          }
        ).__echoLyrics,
    );
    expect(info.lines.length).toBe(tl.lines.length);
    expect(Math.max(...info.lines.map((l) => l.rows))).toBeLessThanOrEqual(3);
    expect(info.lines.some((l) => l.rows === 3)).toBe(true); // the fixture does need 3 rows here
    const H = 640 - DOCK;
    for (const i of [0, 2, 3]) {
      const l = tl.lines[i] as LyricLine;
      await frame(page, 'long-lines', (tl.handovers[i + 1] ?? l.start + 3000) - 50);
      const zone = main(await lines(page));
      const deepest = Math.max(...zone.filter((x) => x.opacity > 0.3).map((x) => x.bottom));
      expect(deepest).toBeLessThanOrEqual(0.86 * H + 1);
    }
  });

  test('LYR-05 on the measured ballad boxes: +1 rises monotonically and stays clear of the active box', async ({
    page,
  }) => {
    await frame(page, 'ballad-word', 9500);
    const m = await page.evaluate(
      () =>
        (
          window as unknown as {
            __echoLyrics: { W: number; H: number; fontPx: number; boxes: LineBox[] };
          }
        ).__echoLyrics,
    );
    const tl = timeline('ballad-word');
    expect(m.boxes.length).toBe(tl.lines.length);
    const model = new FieldModel(tl, m.boxes, { seed: 1, budget: 0, dotsH: m.fontPx * 1.12 });
    const FRAME = 1000 / 60;
    const ys = new Map<number, number[]>();
    for (let t = 0; t < 220_000; t += FRAME) {
      model.update({ t, dt: FRAME, driftS: t / 1000, playing: true, mode: 'run', W: m.W, H: m.H });
      const act = [...model.insts.values()].find((v) => v.role === 'zone' && v.rank === 0);
      const up = [...model.insts.values()].find((v) => v.role === 'zone' && v.rank === 1);
      if (!act || !up) continue;
      const since = t - (tl.handovers[act.i] as number);
      if (since < 1200 || Math.round(since) % 100 > FRAME) continue; // every 100 ms, once settled
      const gap =
        up.y.x -
        ((m.boxes[up.i] as LineBox).h * up.scale) / 2 -
        (act.y.x + (m.boxes[act.i] as LineBox).h / 2);
      expect(gap).toBeGreaterThanOrEqual(0.02 * m.H - 0.5);
      const list = ys.get(act.i) ?? [];
      list.push(up.y.x);
      ys.set(act.i, list);
    }
    expect(ys.size).toBeGreaterThan(15);
    for (const list of ys.values())
      for (let k = 1; k < list.length; k++)
        expect(list[k]).toBeLessThanOrEqual((list[k - 1] as number) + 1e-6);
  });

  test('resize 1440 → 1024 → 2560: re-laid out after the last change, nothing off stage (LYR-22)', async ({
    page,
  }) => {
    const tl = timeline('ballad-word');
    const active = tl.lines[2] as LyricLine;
    await frame(page, 'ballad-word', active.start + 1500);
    // Logged in the page: resize events and every width the field is laid out at.
    await page.evaluate(() => {
      const w = window as unknown as {
        __echoLyrics?: { W: number; at: number };
        __log: [string, number][];
      };
      w.__log = [];
      addEventListener('resize', () => w.__log.push(['resize', performance.now()]));
      let laid = w.__echoLyrics?.W;
      const tick = () => {
        if (w.__echoLyrics?.W !== laid) {
          laid = w.__echoLyrics?.W;
          w.__log.push([`laid ${laid}`, w.__echoLyrics?.at ?? 0]); // when the field laid out
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.waitForTimeout(40);
    await page.setViewportSize({ width: 2560, height: 1440 });
    const log = () =>
      page.evaluate(() => (window as unknown as { __log: [string, number][] }).__log);
    await expect.poll(async () => (await log()).some(([e]) => e === 'laid 2560')).toBe(true);
    await page.waitForTimeout(300);
    const events = await log();
    // Every layout waits 120 ms after the resize before it (a slow resize step may let 1024 lay
    // out too), and the last one is at the final size.
    const laids = events.filter(([e]) => e.startsWith('laid'));
    expect(laids.at(-1)?.[0]).toBe('laid 2560');
    for (const [, at] of laids) {
      const before = Math.max(
        ...events.filter(([e, t]) => e === 'resize' && t < at).map(([, t]) => t),
      );
      expect(at - before).toBeGreaterThanOrEqual(110);
    }
    const last = Math.max(...events.filter(([e]) => e === 'resize').map(([, t]) => t));
    const laid = laids.at(-1)?.[1] ?? 0;
    // Then ~20 ms of measuring and a frame. How long that takes here is the test machine's: with
    // SwiftShader drawing 2560×1440 in software it ranged 0.27–1.4 s, so the bound only catches
    // "never".
    expect(laid - last).toBeLessThan(3000);
    test
      .info()
      .annotations.push({ type: 'relayout', description: `${Math.round(laid - last)} ms` });
    // No springs: the active line is already in its new place.
    const a = main(await lines(page)).find((l) => l.text === active.text);
    expect(Math.abs((a?.cy ?? 0) - 0.4 * (1440 - DOCK))).toBeLessThanOrEqual(2);
    for (const l of main(await lines(page))) {
      expect(l.left).toBeGreaterThanOrEqual(0);
      expect(l.right).toBeLessThanOrEqual(2560);
      expect(l.bottom).toBeLessThanOrEqual(1440 - DOCK);
    }
  });
});

test('untimed: a static sheet, scrollable, with the note and attribution (LYR-14)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto('/?frame=0&fixture=static');
  const sheet = page.getByRole('document', { name: 'Lyrics' });
  await expect(sheet).toBeVisible();
  await expect(page.locator('.ly-field')).toHaveCount(0);
  await expect(sheet.locator('.ly-sheet-note')).toHaveText(
    'Lyrics aren’t time-synced for this track · Fixture lyrics written for ECHO',
  );
  await expect(sheet.locator('.ly-sheet-line')).toHaveCount(
    doc('static').lines.filter((l) => l.text.trim()).length,
  );
  await sheet.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => sheet.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const afterArrow = await sheet.evaluate((el) => el.scrollTop);
  await page.keyboard.press('PageDown');
  await expect.poll(() => sheet.evaluate((el) => el.scrollTop)).toBeGreaterThan(afterArrow + 50);
  await sheet.evaluate((el) => el.scrollTo(0, 0));
  await sheet.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => sheet.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

// ---------- real time: the guide tracks ----------

const dock = (page: Page) => page.getByRole('region', { name: 'Player' });

async function playGuide(page: Page, name: string, atS: number) {
  await page.goto('/library/album/al-guide');
  await page.getByRole('button', { name: `Play ${name}`, exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Listen' })
    .click();
  await expect(page.locator('.ly-field')).toBeAttached();
  await seekTo(page, atS);
}

async function seekTo(page: Page, atS: number) {
  const s = page.locator('.dock-scrub .slider');
  const box = await s.boundingBox();
  const total = (doc('ballad-word').durationMs ?? 1) / 1000;
  if (!box) throw new Error('scrubber');
  await page.mouse.click(box.x + box.width * (atS / total), box.y + box.height / 2);
}

/** The sweeping word of the active line: its text, --p and glow alpha. */
const sweeping = (page: Page) =>
  page.evaluate(() => {
    const w = document.querySelector<HTMLElement>('.ly-main .ly-w.sweep');
    if (!w) return null;
    // An emphasised word carries its sweep on its graphemes (§5.5).
    const p = [w, ...w.querySelectorAll<HTMLElement>('.ly-g')]
      .map((x) => x.style.getPropertyValue('--p'))
      .join(' ');
    return { text: w.textContent, p, glow: Number(w.style.getPropertyValue('--ga') || 0) };
  });

test('pause freezes the sweep and dims the glow to 60%; resume restores it (LYR-17)', async ({
  page,
}) => {
  // The ballad's longest held word: it is still sweeping well after the pause lands.
  const held = timeline('ballad-word')
    .lines.flatMap((l) => l.words ?? [])
    .reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  // Paused first, then seeked into the word: the pause itself cannot race the song, however slow
  // the test machine. (The 600 ms dim and 300 ms restore are timed in model.test.ts.)
  await playGuide(page, 'ballad-word', held.start / 1000 - 3);
  await dock(page).getByRole('button', { name: 'Pause' }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'paused');
  await seekTo(page, (held.start + 250) / 1000); // early in the word: most of it is left to resume into
  await expect.poll(() => sweeping(page).then((s) => s?.text), { timeout: 3000 }).toBe(held.text);
  await expect
    .poll(() => sweeping(page).then((s) => s?.glow), { timeout: 3000 })
    .toBeCloseTo(0.35 * 0.6, 2); // the paused glow: 60%
  const frozen = await sweeping(page);
  await page.waitForTimeout(800);
  expect(await sweeping(page)).toEqual(frozen); // t is frozen: same word, same --p, same glow
  await dock(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => sweeping(page).then((s) => (s?.text === held.text ? s.glow : 1)), {
      timeout: 2000,
    })
    .toBeGreaterThan(0.33);
  expect((await sweeping(page))?.p).not.toBe(frozen?.p);
});

test('scrub: lines follow the drag directly, then settle on the slow spring (LYR-18)', async ({
  page,
}) => {
  const tl = timeline('ballad-word');
  await playGuide(page, 'ballad-word', 12);
  const s = page.locator('.dock-scrub .slider');
  const box = await s.boundingBox();
  if (!box) throw new Error('scrubber');
  const total = (doc('ballad-word').durationMs ?? 1) / 1000;
  const x = (sec: number) => box.x + box.width * (sec / total);
  const y = box.y + box.height / 2;
  await page.mouse.move(x(12), y);
  await page.mouse.down();
  const H = (page.viewportSize()?.height ?? 900) - DOCK;
  for (const i of [3, 5, 7]) {
    const l = tl.lines[i] as LyricLine;
    await page.mouse.move(x((l.start + 1500) / 1000), y, { steps: 4 });
    // No springs while dragging: the line is in place on the next frames.
    await expect
      .poll(async () => main(await lines(page)).find((v) => v.text === l.text)?.cy ?? 0, {
        timeout: 500,
        intervals: [16],
      })
      .toBeCloseTo(0.4 * H, 0);
  }
  const target = tl.lines[9] as LyricLine;
  await page.mouse.move(x((target.start + 1500) / 1000), y, { steps: 2 });
  await page.mouse.up();
  const released = Date.now();
  await expect
    .poll(
      async () => {
        const a = main(await lines(page)).find((v) => v.text === target.text);
        return Math.abs((a?.cy ?? 0) - 0.4 * H);
      },
      { timeout: 1500, intervals: [30] },
    )
    .toBeLessThanOrEqual(2);
  expect(Date.now() - released).toBeLessThan(900 + 200); // settle ≤ 900 ms, plus polling slack
});
