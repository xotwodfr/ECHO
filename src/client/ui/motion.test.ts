import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { motionLevel, springPoints } from './motion.ts';

// The owner's spring (docs/superpowers/specs/2026-11-02-spring-motion-design.md, Motion Lab C).

describe('the spring', () => {
  it('samples the owner’s spring: 49 points ending at 1, ~4.9% overshoot, 592 ms', () => {
    const { points, durationMs } = springPoints(230, 21);
    expect(points).toHaveLength(49);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    expect(Math.max(...points)).toBeCloseTo(1.049, 2);
    expect(durationMs).toBe(592);
  });

  it('tokens.css carries exactly that spring', () => {
    const { points, durationMs } = springPoints(230, 21);
    const css = readFileSync(join('src/client', 'tokens.css'), 'utf8');
    expect(css).toContain(`--ease-spring: linear(${points.join(', ')})`);
    expect(css).toContain(`--dur-spring: ${durationMs}ms`);
  });
});

describe('motion levels', () => {
  it.each([
    ['system', false, 'full'],
    ['system', true, 'less'],
    ['full', true, 'full'],
    ['reduced', false, 'less'],
    ['off', false, 'off'],
  ] as const)('motionLevel(%s, reduced=%s) = %s', (pref, sys, want) =>
    expect(motionLevel(pref, sys)).toBe(want),
  );
});
