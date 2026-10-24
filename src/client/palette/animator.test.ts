import { describe, expect, it } from 'vitest';
import { createPaletteAnimator, DUR_PALETTE_MS, ROLES, type Roles } from './animator.ts';

// VIS-04: OKLab interpolation over 1200 ms, no frame-to-frame ΔE_ok jump > 0.02, continuous retarget.

const FALLBACK: Roles = {
  room: 'oklch(0.16 0.006 250)',
  accent: '#E3B26B',
  highlight: 'oklch(0.92 0.04 80)',
  glow: 'oklch(0.68 0.10 75 / 0.35)',
  shadow: 'oklch(0.08 0.004 250)',
  inkActive: 'oklch(0.95 0.006 80)',
};
// Extremes from the fixture covers: a saturated red room and a teal accent, then a blue one.
const RED: Roles = {
  room: 'oklch(0.2400 0.1000 29.00)',
  accent: 'oklch(0.7000 0.1800 190.00)',
  highlight: 'oklch(0.8600 0.1000 330.00)',
  glow: 'oklch(0.6000 0.1400 190.00 / 0.35)',
  shadow: 'oklch(0.0600 0.0400 29.00)',
  inkActive: 'oklch(0.9500 0.0120 330.00)',
};
const BLUE: Roles = {
  room: 'oklch(0.1200 0.1000 264.00)',
  accent: 'oklch(0.8200 0.1800 70.00)',
  highlight: 'oklch(0.9400 0.0500 100.00)',
  glow: 'oklch(0.7200 0.1400 70.00 / 0.35)',
  shadow: 'oklch(0.1000 0.0400 264.00)',
  inkActive: 'oklch(0.9500 0.0075 100.00)',
};

const dE = (a: number[], b: number[]) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

function maxStep(run: (step: () => void) => void, anim: ReturnType<typeof createPaletteAnimator>) {
  let worst = 0;
  let prev = anim.lab();
  run(() => {
    anim.step(1000 / 60);
    const now = anim.lab();
    for (const r of ROLES) worst = Math.max(worst, dE(prev[r], now[r]));
    prev = now;
  });
  return worst;
}

describe('palette transitions (VIS-04)', () => {
  it('reaches the target in 1200 ms and stops changing', () => {
    const a = createPaletteAnimator(FALLBACK);
    a.retarget(RED);
    let frames = 0;
    while (a.step(1000 / 60)) frames++;
    expect(frames).toBe(Math.ceil(DUR_PALETTE_MS / (1000 / 60)));
    expect(a.animating).toBe(false);
    expect(a.css()).toEqual(createPaletteAnimator(RED).css());
    expect(a.step(16)).toBe(false);
  });

  it('no role jumps by more than ΔE_ok 0.02 between 60 Hz frames, even between extremes', () => {
    const a = createPaletteAnimator(RED);
    a.retarget(BLUE);
    const worst = maxStep((s) => {
      for (let i = 0; i < 80; i++) s();
    }, a);
    expect(worst).toBeLessThanOrEqual(0.02);
    expect(worst).toBeGreaterThan(0.005); // it did move
  });

  it('a retarget mid-transition continues from the colour on screen', () => {
    const a = createPaletteAnimator(FALLBACK);
    a.retarget(RED);
    for (let i = 0; i < 30; i++) a.step(1000 / 60); // halfway
    const worst = maxStep((s) => {
      a.retarget(BLUE); // a rapid skip
      for (let i = 0; i < 80; i++) s();
    }, a);
    expect(worst).toBeLessThanOrEqual(0.02);
    expect(a.css()).toEqual(createPaletteAnimator(BLUE).css());
  });

  it('interpolates in OKLab, not by hue: red → teal passes near grey, not through green', () => {
    const a = createPaletteAnimator({ ...RED, accent: 'oklch(0.7 0.15 30)' });
    a.retarget({ ...RED, accent: 'oklch(0.7 0.15 210)' });
    for (let i = 0; i < 36; i++) a.step(1000 / 60);
    const [, x, y] = a.lab().accent;
    expect(Math.hypot(x, y)).toBeLessThan(0.02); // opposite hues meet at the grey axis
  });

  it('writes OKLCH strings, with the glow alpha kept', () => {
    const css = createPaletteAnimator(RED).css();
    expect(css.glow).toBe('oklch(0.6000 0.1400 190.00 / 0.350)');
    expect(css.room).toBe('oklch(0.2400 0.1000 29.00)');
    const hex = createPaletteAnimator(FALLBACK).css().accent;
    expect(hex).toMatch(/^oklch\(0\.79\d+ 0\.1\d+ 7\d\.\d+\)$/);
  });
});
