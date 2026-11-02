import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  motionLevel,
  noteLoading,
  noteRoute,
  occurrenceKeys,
  shouldArrive,
  springPoints,
  toMs,
} from './motion.ts';

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

describe('queue rows keep who they are across moves', () => {
  it('numbers each key by its occurrence', () =>
    expect(occurrenceKeys(['a', 'b', 'a'])).toEqual(['a#0', 'b#0', 'a#1']));

  it('a move keeps every row its key', () => {
    const before = occurrenceKeys(['a', 'b', 'c']);
    const after = occurrenceKeys(['c', 'a', 'b']);
    expect(new Set(after)).toEqual(new Set(before));
    expect(after[0]).toBe('c#0');
  });
});

describe('loaded content arrives in a wave, only after a placeholder', () => {
  it('waves only when a placeholder showed since the page changed', () => {
    noteRoute();
    expect(shouldArrive()).toBe(false); // a page restored from cache: no wave
    noteLoading();
    expect(shouldArrive()).toBe(true);
    noteRoute();
    expect(shouldArrive()).toBe(false);
  });
});

describe('CSS times', () => {
  it.each([
    ['592ms', 592],
    ['.592s', 592],
    ['0.18s', 180],
    ['0ms', 0],
    ['0s', 0],
    ['', 0],
  ])('%s is %d ms', (t, ms) => expect(toMs(t)).toBeCloseTo(ms));
});
