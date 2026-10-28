import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricsDoc, Track } from '../../shared/types.ts';
import { ManualClock } from '../playback/clock.ts';
import { createPlaybackController } from '../playback/controller.ts';
import { FakeProvider } from '../playback/fake.ts';
import { prefsStore } from '../prefs.ts';
import { lyricsStore } from '../stage/status.ts';
import {
  DEBOUNCE_MS,
  GIVE_UP_MS,
  isInstrumental,
  lineAt,
  nudgeLyrics,
  startLyricsLoader,
} from './loader.ts';

// LYRICS_INTEGRATION.md §6 and LYRICS_EXPERIENCE.md §9.5 on the client: debounce, stale answers
// dropped, the 6 s give-up and the late answer, the scrubber's line lookup.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const track = (n: number): Track => ({
  key: `navidrome:t${n}`,
  provider: 'navidrome',
  id: `t${n}`,
  title: `Track ${n}`,
  artists: [{ name: 'A' }],
  album: { title: 'Al', key: 'navidrome:al' },
  durationMs: 200_000,
  artwork: [],
});
const doc = (key: string): LyricsDoc => ({
  version: 1,
  trackKey: key,
  sync: 'line',
  source: 'lrclib',
  attribution: { text: 'Lyrics from LRCLIB' },
  offsetMs: 0,
  lines: [
    { text: 'one', start: 1000 },
    { text: 'two', start: 5000 },
  ],
  fetchedAt: '',
});

function setup(delays: Record<string, number>) {
  const clock = new ManualClock();
  const c = createPlaybackController({ provider: new FakeProvider({ clock, loadMs: 1 }), clock });
  const asked: string[] = [];
  startLyricsLoader(
    c,
    () => {},
    (t) => {
      asked.push(t.key);
      return new Promise((r) =>
        setTimeout(
          () =>
            r(
              delays[t.key] === -1
                ? {
                    doc: null,
                    tried: [{ source: 'lrclib', outcome: 'notFound' }],
                    offsetMs: 0,
                    pinnedSource: null,
                  }
                : { doc: doc(t.key), tried: [], offsetMs: 100, pinnedSource: null },
            ),
          Math.max(0, delays[t.key] ?? 10),
        ),
      );
    },
  );
  return { c, asked };
}
const album = [1, 2, 3, 4, 5, 6].map(track);
const ctx = { kind: 'album', id: 'al', title: 'Al' } as const;

describe('the lyrics loader', () => {
  it('rapid skips: one request, for the track that stays; never another track’s lyrics (LYR-19)', async () => {
    const { c, asked } = setup({ 'navidrome:t1': 10 });
    c.playList(album, 0, ctx);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100); // 5 changes in 0.5 s
      c.next();
    }
    expect(lyricsStore.getState()).toMatchObject({ state: 'waiting', trackKey: 'navidrome:t6' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 20);
    expect(asked.filter((k) => k !== 'navidrome:t2')).toEqual(['navidrome:t6']); // t2… only if prefetched
    expect(lyricsStore.getState()).toMatchObject({
      state: 'ready',
      doc: { trackKey: 'navidrome:t6' },
      offsetMs: 100,
    });
  });

  it('a stale answer is dropped', async () => {
    const { c } = setup({ 'navidrome:t1': 2000, 'navidrome:t2': 10 });
    c.playList(album, 0, ctx);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
    c.next();
    await vi.advanceTimersByTimeAsync(3000);
    expect(lyricsStore.getState().doc?.trackKey).toBe('navidrome:t2');
  });

  it('gives up at 6 s (Cover mode), and a late answer still lands', async () => {
    const { c } = setup({ 'navidrome:t1': 7000 });
    c.playList(album, 0, ctx);
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS + 10);
    expect(lyricsStore.getState().state).toBe('missing');
    await vi.advanceTimersByTimeAsync(2000);
    expect(lyricsStore.getState()).toMatchObject({
      state: 'ready',
      doc: { trackKey: 'navidrome:t1' },
    });
  });

  it('not found carries the sources tried', async () => {
    const { c } = setup({ 'navidrome:t1': -1 });
    c.playList(album, 0, ctx);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
    expect(lyricsStore.getState()).toMatchObject({
      state: 'missing',
      tried: [{ source: 'lrclib', outcome: 'notFound' }],
    });
  });

  // ON-LY-6: the previous track's offset stayed in the store until the next answer, so a nudge then
  // saved it (±50) to the new track; and one shared save timer dropped the first of two saves.
  it('offsets belong to their track: reset on a change, saved per track', async () => {
    const saved: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') saved.push(`${decodeURIComponent(url)} ${init.body}`);
      return new Response('{}');
    });
    try {
      const { c } = setup({});
      c.playList(album, 0, ctx);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 20); // t1 ready, its offset is +100
      nudgeLyrics(1); // t1: +150, saved after 500 ms
      c.next();
      expect(lyricsStore.getState()).toMatchObject({ trackKey: 'navidrome:t2', offsetMs: 0 });
      nudgeLyrics(1); // t2's offset is not known yet: ignored
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 20); // t2 ready at +100
      nudgeLyrics(-1); // t2: +50
      await vi.advanceTimersByTimeAsync(600);
      expect(saved).toEqual([
        '/api/v1/me/tracks/navidrome:t1/override {"offsetMs":150}',
        '/api/v1/me/tracks/navidrome:t2/override {"offsetMs":50}',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // QA 2026-10-28: with a global offset set, the toast showed the track's part only.
  it('the toast shows the total offset, the global one included', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}'));
    const toasts: string[] = [];
    prefsStore.setState({
      ...prefsStore.getState(),
      lyrics: { ...prefsStore.getState().lyrics, globalOffsetMs: 200 },
    });
    try {
      const clock = new ManualClock();
      const c = createPlaybackController({
        provider: new FakeProvider({ clock, loadMs: 1 }),
        clock,
      });
      startLyricsLoader(
        c,
        (m) => toasts.push(m),
        async (t) => ({
          doc: doc(t.key),
          tried: [],
          offsetMs: 0,
          pinnedSource: null,
        }),
      );
      c.playList(album, 0, ctx);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 20);
      nudgeLyrics(1);
      expect(toasts.at(-1)).toBe('Lyrics +250 ms');
    } finally {
      prefsStore.setState({
        ...prefsStore.getState(),
        lyrics: { ...prefsStore.getState().lyrics, globalOffsetMs: 0 },
      });
      vi.unstubAllGlobals();
    }
  });

  // §9.4: an instrumental shows the cover with no "No lyrics found" (QA on a real library).
  it('instrumentals: flagged by a source, or "instrumental" in the title', () => {
    const none = [{ outcome: 'notFound' }];
    expect(isInstrumental('House Of Balloons (Instrumental)', none)).toBe(true);
    expect(isInstrumental('Aerodynamic', [{ outcome: 'instrumental' }])).toBe(true);
    expect(isInstrumental('Instrumentalist', none)).toBe(false);
    expect(isInstrumental('Dreams', none)).toBe(false);
  });

  it('the scrubber’s line: the last line started by then', () => {
    const d = doc('x');
    expect(lineAt(d, 500)).toBeNull();
    expect(lineAt(d, 1000)).toBe('one');
    expect(lineAt(d, 9000)).toBe('two');
    expect(lineAt({ ...d, sync: 'none' }, 9000)).toBeNull();
  });
});
