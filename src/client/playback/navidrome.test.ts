import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, Track } from '../../shared/types.ts';
import { NavidromeProvider } from './navidrome.ts';

// NavidromeProvider against a fake <audio> that follows the HTML spec where it matters here: a new
// `src` and `pause()` reject pending play() promises with AbortError, and play() on an element
// whose source failed rejects with NotSupportedError.

class FakeAudio extends EventTarget {
  preload = '';
  currentTime = 0;
  paused = true;
  volume = 1;
  error: { code: number; message: string } | null = null;
  srcSets = 0;
  private source = '';
  private pending: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  get src() {
    return this.source;
  }
  set src(v: string) {
    this.source = v;
    this.srcSets++;
    this.error = null;
    this.paused = true;
    this.abortPending();
  }
  canPlayType = () => 'maybe';
  play() {
    if (this.error) return Promise.reject(new DOMException('no source', 'NotSupportedError'));
    this.paused = false;
    return new Promise<void>((resolve, reject) => this.pending.push({ resolve, reject }));
  }
  pause() {
    this.paused = true;
    this.abortPending();
    this.fire('pause');
  }
  load() {}
  removeAttribute() {}
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
  /** The source failed (Chrome and Firefox report an HTTP error before metadata as code 4). */
  fail(code = 4) {
    this.error = { code, message: 'MEDIA_ELEMENT_ERROR' };
    this.fire('error');
  }
  private abortPending() {
    const p = this.pending;
    this.pending = [];
    for (const x of p) x.reject(new DOMException('interrupted', 'AbortError'));
  }
}

class FakeNode {
  gain = { value: 1 };
  fftSize = 0;
  smoothingTimeConstant = 0;
  minDecibels = 0;
  maxDecibels = 0;
  connect<T>(n: T) {
    return n;
  }
}

const track = (n: number): Track => ({
  key: `navidrome:t${n}`,
  provider: 'navidrome',
  id: `t${n}`,
  title: `Track ${n}`,
  artists: [{ name: 'A' }],
  album: { id: 'a', title: 'Album', key: 'navidrome:a' },
  durationMs: 200_000,
  artwork: [],
});

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('NavidromeProvider', () => {
  let a: FakeAudio;
  let p: NavidromeProvider;
  let errors: AppError[];

  beforeEach(() => {
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        destination = new FakeNode();
        createAnalyser = () => new FakeNode();
        createGain = () => new FakeNode();
        createMediaElementSource = () => new FakeNode();
        resume = async () => {};
      },
    );
    // The reachability probe (connection.ts) answers at once.
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    a = new FakeAudio();
    const els = [a, new FakeAudio()] as unknown as [HTMLAudioElement, HTMLAudioElement];
    p = new NavidromeProvider(els, { transcodeOffset: true, scrobble: false });
    errors = [];
    p.on('error', (e) => errors.push(e));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ON-PB-1: an interrupted play() is not a broken stream.
  it('a newer load interrupting a pending play() is not an error', async () => {
    void p.load(track(1), { autoplay: true });
    a.fire('loadedmetadata');
    await flush(); // play() is now pending (no 'playing' yet)
    void p.load(track(2), { autoplay: true }); // Next again: the new src aborts that play()
    await flush();
    expect(errors).toEqual([]);
  });

  it('pausing before the audio starts is not an error', async () => {
    void p.load(track(1), { autoplay: true });
    a.fire('loadedmetadata');
    await flush();
    await p.pause();
    await flush();
    expect(errors).toEqual([]);
  });

  // ON-PB-2 (REL-02): a source that fails before its metadata is reloaded 3 times, then skipped.
  it('a stream failing before metadata is retried 3 times, then reported once', async () => {
    vi.useFakeTimers();
    void p.load(track(1), { autoplay: true });
    a.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual([]); // not skipped at once
    for (const wait of [500, 1000, 2000]) {
      await vi.advanceTimersByTimeAsync(wait);
      a.fail();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(a.srcSets).toBe(4); // the first load and three reloads
    expect(errors.map((e) => e.code)).toEqual(['navidrome.stream']);
  });

  it('a stream that fails once before metadata plays on the reload', async () => {
    vi.useFakeTimers();
    void p.load(track(1), { autoplay: true });
    a.fail();
    await vi.advanceTimersByTimeAsync(500);
    a.fire('loadedmetadata');
    await vi.advanceTimersByTimeAsync(0);
    expect(a.paused).toBe(false); // playing on the reload
    expect(errors).toEqual([]);
  });
});
