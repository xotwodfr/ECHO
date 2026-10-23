import { describe, expect, it } from 'vitest';
import {
  linearSrgbToOklab,
  linearToSrgb,
  oklabToLinearSrgb,
  parseColor,
  srgbToLinear,
  type Vec3,
} from './oklab.ts';

function close(a: number[], b: number[], eps = 1e-4) {
  for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i] as number, -Math.log10(eps));
}

describe('OKLab', () => {
  // Reference values from Björn Ottosson's OKLab post (sRGB primaries and white).
  it.each([
    [
      [1, 1, 1],
      [1, 0, 0],
    ],
    [
      [1, 0, 0],
      [0.627955, 0.224863, 0.125846],
    ],
    [
      [0, 1, 0],
      [0.86644, -0.233888, 0.179498],
    ],
    [
      [0, 0, 1],
      [0.452014, -0.032457, -0.311528],
    ],
  ] as [Vec3, Vec3][])('linear %j ↔ OKLab %j', (rgb, lab) => {
    close(linearSrgbToOklab(rgb), lab);
    close(oklabToLinearSrgb(lab), rgb, 1e-3);
  });

  it('the sRGB transfer function round-trips and matches the breakpoints', () => {
    for (const v of [0, 0.002, 0.04045, 0.2, 0.5, 1])
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
  });

  it('parses the token colour forms', () => {
    close(parseColor('#FFFFFF').rgb, [1, 1, 1]);
    close(parseColor('#E3B26B').rgb, [
      srgbToLinear(0xe3 / 255),
      srgbToLinear(0xb2 / 255),
      srgbToLinear(0x6b / 255),
    ]);
    const glow = parseColor('oklch(0.68 0.10 75 / 0.35)');
    expect(glow.alpha).toBe(0.35);
    close(
      linearSrgbToOklab(glow.rgb),
      [0.68, 0.1 * Math.cos((75 * Math.PI) / 180), 0.1 * Math.sin((75 * Math.PI) / 180)],
      1e-3,
    );
    expect(() => parseColor('rgb(1,2,3)')).toThrow();
    expect(() => parseColor('#12345')).toThrow();
  });

  // What the production CSS minifier makes of the tokens (seen in the built bundle).
  it('parses minified forms the same as the written ones', () => {
    const same = (a: string, b: string) => {
      const x = parseColor(a);
      const y = parseColor(b);
      close([...x.rgb, x.alpha], [...y.rgb, y.alpha], 1e-6);
    };
    same('oklch(68% .1 75/.35)', 'oklch(0.68 0.10 75 / 0.35)');
    same('oklch(.16 .006 250)', 'oklch(0.16 0.006 250)');
    same('oklch(0.92 10% 80deg)', 'oklch(0.92 0.04 80)');
    same('oklch(0.92 0.04 0.25turn)', 'oklch(0.92 0.04 90)');
    same('#e3b26b', '#E3B26B');
    same('#fff', '#FFFFFF');
    expect(parseColor('#ffffff80').alpha).toBeCloseTo(128 / 255, 6);
  });
});
