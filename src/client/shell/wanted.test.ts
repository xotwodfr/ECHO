import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import {
  addWanted,
  ago,
  loadWanted,
  removeWanted,
  sendWaitingRemovals,
  type WantedItem,
  wantedStore,
  youTubeMusicSearch,
} from './wanted.ts';

vi.mock('../api.ts', () => ({ api: vi.fn() }));
const mockApi = vi.mocked(api);

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

// B8: removing is one tap for anyone's item, so it can be undone while its toast is up. Nothing
// reaches the server until then, so an undone item keeps who added it and when.
describe('removing from Wanted', () => {
  const item = (id: number, text: string): WantedItem => ({
    id,
    text,
    addedBy: 'ada',
    addedAt: NOW,
    found: null,
  });
  const texts = () => (wantedStore.getState().items as WantedItem[]).map((x) => x.text);
  const deletes = () => mockApi.mock.calls.filter(([, init]) => init?.method === 'DELETE');

  beforeEach(() => {
    vi.useFakeTimers();
    mockApi.mockReset();
    mockApi.mockResolvedValue(undefined);
    wantedStore.setState({ items: [item(1, 'a'), item(2, 'b'), item(3, 'c')] });
  });
  afterEach(() => vi.useRealTimers());

  it('goes from the list at once and from the server once it can no longer be undone', async () => {
    const r = removeWanted(2, 4000);
    expect(texts()).toEqual(['a', 'c']);
    await vi.advanceTimersByTimeAsync(3999);
    expect(deletes()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(deletes()).toEqual([['/wanted/2', { method: 'DELETE' }]]);
    expect(await r.done).toBe('removed');
  });

  it('Undo puts it back where it was, and nothing reaches the server', async () => {
    const r = removeWanted(2, 4000);
    r.undo();
    expect(texts()).toEqual(['a', 'b', 'c']);
    expect(await r.done).toBe('undone');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deletes()).toHaveLength(0);
    r.undo(); // twice is nothing
    expect(texts()).toEqual(['a', 'b', 'c']);
  });

  it('a refused removal comes back and says so', async () => {
    mockApi.mockRejectedValue(new Error('500'));
    const r = removeWanted(1, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(await r.done).toBe('failed');
    expect(texts()).toEqual(['a', 'b', 'c']);
  });

  it('leaving the page sends what is waiting at once, outliving the page', async () => {
    const r = removeWanted(3, 4000);
    sendWaitingRemovals(); // on `pagehide`
    expect(deletes()).toEqual([['/wanted/3', { method: 'DELETE', keepalive: true }]]);
    expect(await r.done).toBe('removed');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deletes()).toHaveLength(1);
  });

  it('a reload while it waits does not bring it back; adding it again keeps it', async () => {
    const r = removeWanted(2, 4000);
    mockApi.mockResolvedValueOnce([item(1, 'a'), item(2, 'b'), item(3, 'c')]);
    await loadWanted();
    expect(texts()).toEqual(['a', 'c']);
    mockApi.mockResolvedValueOnce(item(2, 'b')); // the server knows the words: the same item
    await addWanted('b');
    expect(await r.done).toBe('undone');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deletes()).toHaveLength(0);
    expect(texts()).toContain('b');
  });
});
