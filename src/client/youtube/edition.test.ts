import { describe, expect, it } from 'vitest';
import { editionOf } from './edition.ts';

describe('the edition (day paper or night)', () => {
  it('follows the device until a choice is made, then keeps the choice', () => {
    expect(editionOf(null, false)).toBe('day');
    expect(editionOf(null, true)).toBe('night');
    expect(editionOf('day', true)).toBe('day');
    expect(editionOf('night', false)).toBe('night');
    expect(editionOf('dusk', true)).toBe('night'); // anything else stored is no choice
  });
});
