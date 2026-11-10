import { expect, type Page, test } from '@playwright/test';
import { lyricFixtures } from '../../src/client/fixtures/lyrics.ts';
import { LYRICS } from '../../src/client/stage/lyrics/lyricsConfig.ts';
import { FieldModel, type LineBox, washAt } from '../../src/client/stage/lyrics/model.ts';
import { buildTimeline } from '../../src/client/stage/lyrics/timing.ts';
import type { LyricLine, LyricsDoc } from '../../src/shared/types.ts';

// M3 tasks 6–7: the lyric field in the browser, on its real layout (LYRICS_EXPERIENCE.md §3–§9).
// Deterministic frames (`?frame=<ms>&fixture=<lyric fixture>`) for positions and states; real-time
// playback of the guide tracks for pause and scrub. The field runs on the CSS room too, so all of
// this runs in Firefox without WebGL.

// The room the floating pill takes at the bottom of the lyrics view (tokens.css --dock-listen).
const DOCK = 104;
/** The lyric column lives in the lyrics view's right side: its edges, from the host's box. */
async function column(page: Page) {
  const host = await page.evaluate(() => {
    const r = (document.querySelector('.ly-host') as HTMLElement).getBoundingClientRect();
    return { x: r.left, w: r.width };
  });
  return {
    left: host.x + ((1 - LYRICS.maxWidth) / 2) * host.w,
    right: host.x + ((1 + LYRICS.maxWidth) / 2) * host.w,
    width: host.w,
  };
}
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
  test('ballad: the active line at 0.40 H in one column, the lines around it fading with distance (LYR-02, LYR-03)', async ({
    page,
  }) => {
    const tl = timeline('ballad-word');
    const active = tl.lines[2] as LyricLine;
    await frame(page, 'ballad-word', (active.start + (active.end ?? active.start)) / 2);
    const vp = page.viewportSize() as { width: number; height: number };
    const H = vp.height - DOCK;
    const ls = main(await lines(page)).sort((x, y) => x.cy - y.cy);
    const a = ls.find((l) => l.text === active.text);
    expect(a).toBeDefined();
    expect(Math.abs((a?.cy ?? 0) - 0.4 * H)).toBeLessThanOrEqual(2);
    expect(a?.opacity).toBe(1);
    expect(a?.blur).toBe(0);
    const fontPx = await page.evaluate(
      () => (window as unknown as { __echoLyrics: { fontPx: number } }).__echoLyrics.fontPx,
    );
    const gap = LYRICS.column.gap * fontPx * 1.12;
    expect(ls.filter((l) => l.cy < (a?.cy ?? 0)).length).toBeGreaterThanOrEqual(2); // sung lines
    expect(ls.filter((l) => l.cy > (a?.cy ?? 0)).length).toBeGreaterThanOrEqual(3);
    const ai = ls.indexOf(a as LineInfo);
    const col = await column(page);
    for (let k = 0; k < ls.length; k++) {
      const l = ls[k] as LineInfo;
      // One column: every line starts at its left edge, one gap below the line before.
      expect(Math.abs(l.left - col.left)).toBeLessThanOrEqual(2);
      if (k > 0)
        expect(Math.abs(l.top - (ls[k - 1] as LineInfo).bottom - gap)).toBeLessThanOrEqual(2);
      // Dimmer and blurrier with distance, both ways.
      const near = ls[k + (k < ai ? 1 : -1)] as LineInfo;
      if (k !== ai) {
        expect(l.opacity).toBeLessThanOrEqual(near.opacity);
        expect(l.blur).toBeGreaterThanOrEqual(near.blur);
      }
    }
  });

  test('word sweep: earlier words lit, the sweeping word at its time, later words unlit, one edge across (LYR-07)', async ({
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
    // One soft edge along the line (§5.1): the words next to the sung one may still, or already,
    // carry its fade; past them everything is lit before and unlit after.
    states.forEach((s, j) => {
      if (j < k - 1) expect(s.cls).toContain('lit');
      if (j === k - 1) expect(s.cls).toMatch(/lit|sweep/);
      if (j === k + 1) expect(s.cls).not.toMatch(/\blit\b/);
      if (j > k + 1) expect(s.cls).not.toMatch(/lit|sweep/);
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
    // The chorus line comes back further down the column: the sweeping copy is the active one.
    const copy = page.locator('.ly-main .ly-line').filter({ hasText: line.text });
    const wash = copy.filter({ has: page.locator('.ly-w.sweep') }).locator('.ly-w');
    await expect(wash).toHaveCount(1);
    await expect(wash).toHaveClass(/ly-wash/);
    await expect(wash).toHaveClass(/sweep/);
    const p = Number.parseFloat(await wash.evaluate((s) => s.style.getPropertyValue('--p')));
    expect(p).toBeCloseTo(washAt(line, line.start + 120) * 100, 0);
    await frame(page, 'pop-line', line.start + 430);
    const done = copy.filter({ has: page.locator('.ly-w.lit') }).locator('.ly-w');
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
    const _vp = page.viewportSize() as { width: number; height: number };
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
      const col = await column(page);
      if (l.oppositeAligned) {
        expect(box.side).toBe('right');
        expect(Math.abs(box.right - col.right)).toBeLessThanOrEqual(2);
      } else {
        expect(box.side).toBe('left');
        expect(Math.abs(box.left - col.left)).toBeLessThanOrEqual(2);
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
  test('long lines at 1024×640: at most 3 rows, the active line whole on the stage (LYR-27)', async ({
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
      const a = main(await lines(page)).find((x) => x.text === l.text);
      expect(a?.top).toBeGreaterThanOrEqual(0);
      expect(a?.bottom).toBeLessThanOrEqual(H);
      expect(a?.right).toBeLessThanOrEqual(1024);
    }
  });

  test('LYR-03 on the measured ballad boxes: the column scrolls without two lines ever overlapping', async ({
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
    const model = new FieldModel(tl, m.boxes, { dotsH: m.fontPx * 1.12 });
    const FRAME = 1000 / 60;
    let worst = Number.POSITIVE_INFINITY; // the smallest gap between two neighbouring lines
    for (let t = 0; t < 220_000; t += FRAME) {
      model.update({ t, dt: FRAME, playing: true, mode: 'run', W: m.W, H: m.H });
      // Lines below a hand-over follow the ones above them later (stagger), never earlier.
      const shown = [...model.insts.values()].sort((a, b) => a.i - b.i);
      for (let k = 1; k < shown.length; k++) {
        const [u, v] = [shown[k - 1], shown[k]] as [(typeof shown)[number], (typeof shown)[number]];
        const top = v.y.x - ((m.boxes[v.i] as LineBox).h * v.scale) / 2;
        const bottom = u.y.x + ((m.boxes[u.i] as LineBox).h * u.scale) / 2;
        worst = Math.min(worst, top - bottom);
      }
    }
    expect(worst).toBeGreaterThan(0);
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
    // The field is as wide as the lyrics view's right side.
    const final = `laid ${(await column(page)).width}`;
    await expect.poll(async () => (await log()).some(([e]) => e === final)).toBe(true);
    await page.waitForTimeout(300);
    const events = await log();
    // Every layout waits 120 ms after the resize before it (a slow resize step may let 1024 lay
    // out too), and the last one is at the final size.
    const laids = events.filter(([e]) => e.startsWith('laid'));
    expect(laids.at(-1)?.[0]).toBe(final);
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
    // The column runs past the stage's ends under its fade, but never off its sides.
    for (const l of main(await lines(page))) {
      expect(l.left).toBeGreaterThanOrEqual(0);
      expect(l.right).toBeLessThanOrEqual(2560);
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
    .getByRole('region', { name: 'Player' })
    .getByRole('button', { name: 'Lyrics', exact: true })
    .click();
  await expect(page.locator('.ly-field')).toBeAttached();
  await seekTo(page, atS);
}

async function seekTo(page: Page, atS: number) {
  const s = page.locator('.dock-scrub .slider');
  const box = await s.boundingBox();
  const total = (doc('ballad-word').durationMs ?? 1) / 1000;
  if (!box) throw new Error('scrubber');
  // On a whole pixel: Firefox drops the fraction (Chromium keeps it), and a pixel of the scrubber is
  // most of a second of a song, so a fractional click lands up to a pixel apart between the two.
  await page.mouse.click(Math.round(box.x + box.width * (atS / total)), box.y + box.height / 2);
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
  // The middle of the word (1.5 s long), so half a pixel of the scrubber either way (about 0.35 s
  // of this song) still lands inside it, with most of a second left to resume into.
  await seekTo(page, (held.start + held.end) / 2 / 1000);
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
        timeout: 2000, // the page under a software renderer and parallel specs
        intervals: [16],
      })
      .toBeCloseTo(0.4 * H, 0);
  }
  const target = tl.lines[9] as LyricLine;
  await page.mouse.move(x((target.start + 1500) / 1000), y, { steps: 2 });
  // Release only once the drag is there: Firefox can deliver the button-up before the last move,
  // and the seek would land a line early.
  await expect
    .poll(async () => main(await lines(page)).find((v) => v.text === target.text)?.cy ?? 0, {
      timeout: 2000,
      intervals: [16],
    })
    .toBeCloseTo(0.4 * H, 0);
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

test('reduced motion: the column and the sweep stay, the words at rest (A11Y-05)', async ({
  page,
}) => {
  const tl = timeline('ballad-word');
  const active = tl.lines[2] as LyricLine;
  const mid = (active.start + (active.end ?? active.start)) / 2;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await frame(page, 'ballad-word', mid);
  const H = (page.viewportSize()?.height ?? 900) - DOCK;
  const a = main(await lines(page)).find((l) => l.text === active.text);
  expect(a?.opacity).toBe(1);
  expect(Math.abs((a?.cy ?? 0) - 0.4 * H)).toBeLessThanOrEqual(2);
  await expect(page.locator('.ly-w.lit, .ly-w.sweep').first()).toBeAttached();
  const moved = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('.ly-scene .ly-lead .ly-w')].filter(
        (w) => w.style.transform,
      ).length,
  );
  expect(moved).toBe(0);
});

test('transcript: a hidden ordered list of every line, aria-current on the active one (A11Y-04)', async ({
  page,
}) => {
  const tl = timeline('ballad-word');
  const active = tl.lines[2] as LyricLine;
  await frame(page, 'ballad-word', (active.start + (active.end ?? active.start)) / 2);
  const list = page.getByRole('list', { name: 'Lyrics' });
  await expect(list.getByRole('listitem')).toHaveCount(tl.lines.length);
  await expect(list.locator('[aria-current="true"]')).toHaveText(active.text);
  await expect(list.locator('[aria-current]')).toHaveCount(1);
  // The field itself is hidden from assistive technology; the transcript is not.
  await expect(page.locator('.ly-scene').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.ly-field')).not.toHaveAttribute('aria-hidden');
});

test('announcements are off by default and, when on, speak the active line (A11Y-04)', async ({
  page,
}) => {
  const tl = timeline('ballad-word');
  const next = tl.lines[2] as LyricLine;
  await playGuide(page, 'ballad-word', next.start / 1000 - 2);
  const live = page.locator('.ly-field [role="status"]');
  await dock(page).getByRole('button', { name: 'Pause' }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'paused');
  await expect(live).toHaveText(''); // opt-in: silent through every hand-over so far
  // Every announcement is recorded as it happens, so a slow poll cannot miss a short line.
  await page.evaluate(() => {
    const w = window as unknown as {
      __echoLyricPrefs: { setState(s: object): void };
      __said: string[];
    };
    w.__said = [];
    const region = document.querySelector('.ly-field [role="status"]') as Element;
    new MutationObserver(() => w.__said.push(region.textContent ?? '')).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    w.__echoLyricPrefs.setState({ announce: true });
  });
  await dock(page).getByRole('button', { name: 'Play', exact: true }).click();
  // What is spoken is the line that takes the anchor at each hand-over from here on. Which line
  // comes first depends on where the pause landed, so any line of the song counts.
  const lines = new Set(tl.lines.map((l) => l.text));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __said: string[] }).__said.length), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
  for (const text of said) expect(lines.has(text)).toBe(true);
});
