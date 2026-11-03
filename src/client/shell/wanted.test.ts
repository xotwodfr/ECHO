import { describe, expect, it } from 'vitest';
import { ago, youTubeMusicSearch } from './wanted.ts';

// The Wanted list's small helpers: when an item was added, and the YouTube Music link.

const NOW = Date.UTC(2026, 10, 3, 12);
const DAY = 86_400_000;

describe('wanted', () => {
  it('says when an item was added the way people do', () => {
    expect(ago(NOW - 30_000, NOW)).toBe('just now');
    expect(ago(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(ago(NOW - DAY, NOW)).toBe('yesterday');
    expect(ago(NOW - 3 * DAY, NOW)).toBe('3 days ago');
    expect(ago(NOW - 8 * DAY, NOW)).toBe('last week');
    expect(ago(NOW - 400 * DAY, NOW)).toBe('last year');
  });

  it('links to the same search on YouTube Music', () => {
    expect(youTubeMusicSearch('Fred again.. & co')).toBe(
      'https://music.youtube.com/search?q=Fred%20again..%20%26%20co',
    );
  });
});
