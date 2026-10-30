import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linearToSrgb, oklabToLinearSrgb, oklchToOklab, parseColor } from '../../shared/oklab.ts';
import type { Roles } from './animator.ts';
import { paletteStore } from './live.ts';
import { type Bake, micaStops, startMica } from './mica.ts';

// Mica (DESIGN_SYSTEM.md §6): the album's glow, blurred once per album into an image behind the
// frame. The stops stay dark enough for the layer's text; the bake runs once per new glow, and a
// late or failed bake never leaves the wrong glow or a leaked object URL.

const roles = (accent: string, highlight = accent, room = 'oklch(0.16 0.006 250)'): Roles => ({
  room,
  accent,
  highlight,
  glow: 'oklch(0.68 0.10 75 / 0.35)',
  shadow: 'oklch(0.08 0.004 250)',
  inkActive: 'oklch(0.98 0.004 80)',
});
const SEEDS = [
  '#E3B26B',
  '#3A6FF2',
  '#D9304A',
  '#2DBE6C',
  '#9B59D0',
  '#808080',
  'oklch(0.76 0.14 200)',
  '#FFF6B0',
  '#F5F5F5',
  '#535353',
];

/** sRGB 0–255 of an `oklch(L C H)` string. */
const rgbOf = (css: string): [number, number, number] => {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css);
  if (!m) throw new Error(css);
  const lin = oklabToLinearSrgb(oklchToOklab(Number(m[1]), Number(m[2]), Number(m[3])));
  return lin.map((v) => linearToSrgb(Math.min(1, Math.max(0, v))) * 255) as [
    number,
    number,
    number,
  ];
};
const over = (top: number[], a: number, under: number[]) =>
  top.map((c, i) => c * a + (under[i] ?? 0) * (1 - a));
const lum = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe('micaStops', () => {
  it.each(SEEDS)('%s: stops are capped dark enough', (seed) => {
    for (const s of micaStops(roles(seed, seed, seed))) {
      const m = /oklch\(\s*([\d.]+)\s+([\d.]+)/.exec(s);
      expect(Number(m?.[1])).toBeGreaterThanOrEqual(0.25);
      expect(Number(m?.[1])).toBeLessThanOrEqual(0.6);
      expect(Number(m?.[2])).toBeLessThanOrEqual(0.15);
    }
  });

  it.each(SEEDS)('%s: secondary text stays readable over the layer over Mica', (seed) => {
    for (const s of micaStops(roles(seed, seed, seed))) {
      const mica = over(rgbOf(s), 0.55, [0x1c, 0x1c, 0x1c]);
      const layer = over([44, 44, 44], 0.55, mica);
      const text = over([255, 255, 255], 0.786, layer);
      expect(contrast(text, layer)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('takes the highlight, accent and room hues', () => {
    const [hi, acc, room] = micaStops(roles('#3A6FF2', '#E3B26B', '#2DBE6C'));
    const blue = rgbOf(acc as string);
    expect(blue[2]).toBeGreaterThan(blue[0]);
    expect(rgbOf(hi as string)[0]).toBeGreaterThan(rgbOf(hi as string)[2]);
    expect(rgbOf(room as string)[1]).toBeGreaterThan(rgbOf(room as string)[0]);
    expect(parseColor('#000').alpha).toBe(1);
  });
});

describe('startMica', () => {
  type Layer = { style: { backgroundImage: string }; dataset: Record<string, string> };
  let layers: Layer[];
  let host: HTMLElement;
  let live: Set<string>;
  let n = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    layers = [0, 1].map(() => ({ style: { backgroundImage: '' }, dataset: {} }));
    host = { children: layers } as unknown as HTMLElement;
    live = new Set();
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('matchMedia', () => ({ addEventListener() {}, removeEventListener() {} }));
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = `blob:${++n}`;
      live.add(u);
      return u;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void live.delete(u));
    paletteStore.setState({ target: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const on = () => layers.filter((l) => 'on' in l.dataset);
  const blob = () => new Blob(['x']);
  const settle = async () => {
    await vi.runAllTimersAsync();
  };

  it('bakes once per glow, not per track', async () => {
    const bake = vi.fn<Bake>(async () => blob());
    const stop = startMica(host, { bake });
    paletteStore.setState({ target: roles('#3A6FF2') });
    await settle();
    paletteStore.setState({ target: { ...roles('#3A6FF2') } });
    await settle();
    expect(bake).toHaveBeenCalledTimes(1);
    expect(on()).toHaveLength(1);
    stop();
  });

  it('rapid skips land on the last album', async () => {
    const pending: ((b: Blob) => void)[] = [];
    const bake: Bake = () => new Promise((r) => pending.push(r));
    const stop = startMica(host, { bake });
    paletteStore.setState({ target: roles('#3A6FF2') });
    paletteStore.setState({ target: roles('#D9304A') });
    paletteStore.setState({ target: roles('#2DBE6C') });
    expect(pending).toHaveLength(3);
    pending[2]?.(blob());
    await settle();
    pending[0]?.(blob());
    pending[1]?.(blob());
    await settle();
    expect(on()).toHaveLength(1);
    expect(on()[0]?.style.backgroundImage).toBe(`url("${[...live][0]}")`);
    expect(live.size).toBe(1);
    stop();
  });

  it('a failed bake leaves the plain base', async () => {
    let calls = 0;
    const bake: Bake = async () => {
      calls++;
      if (calls === 1) return blob();
      if (calls === 2) return null;
      throw new Error('no canvas');
    };
    const stop = startMica(host, { bake });
    paletteStore.setState({ target: roles('#3A6FF2') });
    await settle();
    expect(on()).toHaveLength(1);
    paletteStore.setState({ target: roles('#D9304A') });
    await settle();
    expect(on()).toHaveLength(0);
    paletteStore.setState({ target: roles('#2DBE6C') });
    await settle();
    expect(on()).toHaveLength(0);
    expect(live.size).toBe(0);
    stop();
  });

  it('null target turns Mica off', async () => {
    const stop = startMica(host, { bake: async () => blob() });
    paletteStore.setState({ target: roles('#3A6FF2') });
    await settle();
    paletteStore.setState({ target: null });
    await settle();
    expect(on()).toHaveLength(0);
    expect(live.size).toBe(0);
    stop();
  });
});
