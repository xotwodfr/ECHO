import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, effectiveVisuals, prefsStore, setPref } from './prefs.ts';

// Settings → Visuals → Performance mode (owner, 2026-11-04): for a slow computer, on that device
// only. Measured on a 4×-throttled Chromium, the live room took Listen to 6 fps and the page
// animations to 41; the still room and the smaller animations kept both at 57–60, lyrics moving.

describe('performance mode', () => {
  const v = { ...DEFAULT_PREFS.visuals, performance: false };

  it('off: the saved visuals, as they are', () => {
    expect(effectiveVisuals(v)).toEqual(v);
  });

  it('on: the smaller animations and the lightest room, over whatever was saved', () => {
    for (const motion of ['system', 'full', 'reduced'] as const)
      expect(effectiveVisuals({ ...v, motion, quality: 'high', performance: true })).toMatchObject({
        motion: 'reduced',
        quality: 'minimal',
      });
    // Off is lighter still (the still lyric sheet): it stays.
    expect(effectiveVisuals({ ...v, motion: 'off', performance: true }).motion).toBe('off');
    // The rest is the user's, the lyrics' word-by-word motion with it.
    expect(
      effectiveVisuals({
        ...v,
        mode: 'reverb',
        intensity: 'subtle',
        backdrop: 0.3,
        performance: true,
      }),
    ).toMatchObject({ mode: 'reverb', intensity: 'subtle', backdrop: 0.3 });
  });
});

describe('performance mode belongs to this device', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is kept in this browser and never sent to the server', async () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, s: string) => kept.set(k, s),
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await setPref('visuals', 'performance', true);
    expect(kept.get('echo.visuals.performance')).toBe('true');
    expect(prefsStore.getState().visuals.performance).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
