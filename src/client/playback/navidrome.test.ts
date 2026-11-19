import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, Track } from '../../shared/types.ts';
import { NavidromeProvider } from './navidrome.ts';

// NavidromeProvider against a fake <audio> that follows the HTML spec where it matters here: a new
// `src` and `pause()` reject pending play() promises with AbortError, and play() on an element
// whose source failed rejects with NotSupportedError.

class FakeAudio extends EventTarget {
  preload = '';
  readyState = 0;
  currentTime = 0;
  duration = Number.NaN;
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

/** Every gain change, for the crossfade's ramps: `curve:in`, `curve:out`, `set:1`. */
const ramps: string[] = [];

class FakeNode {
  gain = {
    value: 1,
    setTargetAtTime(v: number) {
      this.value = v;
    },
    setValueCurveAtTime(c: Float32Array) {
      this.value = c[c.length - 1] as number;
      ramps.push(`curve:${(c[0] as number) < 0.5 ? 'in' : 'out'}`);
    },
    setValueAtTime(v: number) {
      this.value = v;
      ramps.push(`set:${v}`);
    },
    cancelScheduledValues() {},
  };
  channelInterpretation = 'speakers';
  channelCount = 2;
  channelCountMode = 'max';
  getFloatTimeDomainData() {}
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

const ytTrack = (id: string): Track => ({
  key: `youtube:${id}`,
  provider: 'youtube',
  id,
  title: `Song ${id}`,
  artists: [{ name: 'A' }],
  album: { title: 'Album', key: `youtube:${id}` },
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
        createChannelSplitter = () => new FakeNode();
        createChannelMerger = () => new FakeNode();
        currentTime = 0;
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

  // QA 2026-10-28 (a regression from ON-PB-2): after the retries were spent, `loading` stayed set,
  // so Play did nothing for ever, even once the network was back.
  it('after a stream failed for good, Play asks for it again', async () => {
    vi.useFakeTimers();
    void p.load(track(1), { autoplay: true });
    a.fail();
    for (const wait of [500, 1000, 2000]) {
      await vi.advanceTimersByTimeAsync(wait);
      a.fail();
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    const before = a.srcSets;
    void p.play(); // the network is back
    await vi.advanceTimersByTimeAsync(0);
    expect(a.srcSets).toBe(before + 1);
    a.fire('loadedmetadata');
    await vi.advanceTimersByTimeAsync(0);
    expect(a.paused).toBe(false);
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

  it('streams youtube tracks through the youtube route', async () => {
    void p.load(ytTrack('x'), { autoplay: true });
    await flush();
    expect(a.src).toMatch(/\/api\/v1\/youtube\/stream\/x$/);
  });

  it('pings youtube history, never the Navidrome scrobble', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      urls.push(String(u));
      return new Response('{}', { status: 200 });
    });
    const els = [a, new FakeAudio()] as unknown as [HTMLAudioElement, HTMLAudioElement];
    p = new NavidromeProvider(els, { transcodeOffset: true, scrobble: true });
    void p.load(ytTrack('x'), { autoplay: true });
    a.fire('loadedmetadata');
    await flush();
    a.paused = false;
    a.fire('playing');
    a.currentTime = 150;
    a.fire('timeupdate');
    await flush();
    expect(urls.filter((u) => u.includes('/youtube/played/x'))).toHaveLength(1);
    expect(urls.some((u) => u.includes('/navidrome/rest/scrobble'))).toBe(false);
  });

  it('a youtube stream that fails for good is reported as youtube.stream', async () => {
    vi.useFakeTimers();
    void p.load(ytTrack('x'), { autoplay: true });
    a.fail();
    for (const wait of [500, 1000, 2000]) {
      await vi.advanceTimersByTimeAsync(wait);
      a.fail();
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(errors.map((e) => e.code)).toEqual(['youtube.stream']);
  });

  // Review 2026-11-03: YouTube's search (All tab) and artist rows carry no duration; without one the
  // player could not seek and showed "0:37 / 0:00". The audio knows it once its metadata loads.
  it("a youtube track without a duration takes the audio's", async () => {
    const states: number[] = [];
    p.on('state', (s) => states.push(s.track?.durationMs ?? -1));
    void p.load({ ...ytTrack('x'), durationMs: 0 }, { autoplay: false });
    a.duration = 212.5;
    a.fire('loadedmetadata');
    await flush();
    expect(states.at(-1)).toBe(212_500);
  });

  // Review 2026-11-03: a YouTube failure said only "could not be played", probed Navidrome, and a
  // bot check walked the whole queue. The server says why; a bot check stops.
  it('a youtube song refused as a bot says so, without asking Navidrome', async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      urls.push(String(u));
      return String(u).includes('/youtube/stream/')
        ? Response.json({ code: 'youtube.bot_check' }, { status: 502 })
        : new Response('{}', { status: 200 });
    });
    void p.load(ytTrack('x'), { autoplay: true });
    a.fail();
    for (const wait of [500, 1000, 2000]) {
      await vi.advanceTimersByTimeAsync(wait);
      a.fail();
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(errors.map((e) => e.code)).toEqual(['youtube.bot_check']);
    expect(errors[0]?.userMessage).toMatch(/bot/);
    expect(urls.some((u) => u.includes('navidrome'))).toBe(false);
  });
});

describe('Karaoke mode (docs/KARAOKE.md)', () => {
  it('a karaoke file keeps its vocals at the slider level; anything else plays whole', async () => {
    const { vocalGains } = await import('./audio.ts');
    // A karaoke file: no centre (it is silent), the rear vocals at the level.
    expect(vocalGains(true, 0)).toEqual({ centre: 0, rear: 0 });
    expect(vocalGains(true, 0.3)).toEqual({ centre: 0, rear: 0.3 });
    expect(vocalGains(true, 7)).toEqual({ centre: 0, rear: 1 });
    // Not a karaoke file: a mono song's centre whole, a 5.1 song's rears as a downmix.
    expect(vocalGains(false, 0)).toEqual({ centre: 1, rear: Math.SQRT1_2 });
  });

  it('a browser that downmixed the 5.1 shows as empty rears while the fronts play', async () => {
    const { looksDownmixed } = await import('./audio.ts');
    const front = new Float32Array([0, 0.2, -0.3]);
    expect(looksDownmixed(front, new Float32Array(3))).toBe(true);
    // A faint residue (an instrumental passage) is not a downmix; nor is silence all round.
    expect(looksDownmixed(front, new Float32Array([0, 1e-6, 0]))).toBe(false);
    expect(looksDownmixed(new Float32Array(3), new Float32Array(3))).toBe(false);
  });

  it('plays the karaoke file instead of the song while Karaoke is on and it is ready', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    const el = new FakeAudio();
    const els = [el, new FakeAudio()] as unknown as [HTMLAudioElement, HTMLAudioElement];
    let karaoke: string | null = null;
    const p = new NavidromeProvider(els, {
      transcodeOffset: true,
      scrobble: false,
      karaokeSrc: () => karaoke,
    });
    const loaded = async (run: Promise<void>) => {
      await flush();
      el.dispatchEvent(new Event('loadedmetadata'));
      await run;
    };
    await loaded(p.load(track(1), { autoplay: false }));
    expect(el.src).toContain('/api/v1/navidrome/stream/t1');
    expect(p.playingKaraoke).toBe(false);
    // Ready: the same song switches to its karaoke file, at the same place.
    karaoke = '/api/v1/karaoke/t1/audio';
    el.currentTime = 42;
    await loaded(p.refreshSource());
    expect(el.src).toBe('/api/v1/karaoke/t1/audio');
    expect(p.playingKaraoke).toBe(true);
    expect(el.currentTime).toBe(42);
    // Off again: back to the song.
    karaoke = null;
    await loaded(p.refreshSource());
    expect(el.src).toContain('/api/v1/navidrome/stream/t1');
  });
});

describe('Crossfade (§5.6)', () => {
  let a: FakeAudio;
  let b: FakeAudio;
  let p: NavidromeProvider;
  let ended: number;
  const other = (n: number): Track => ({
    ...track(n),
    album: { id: `b${n}`, title: 'Other', key: `navidrome:b${n}` },
  });

  beforeEach(async () => {
    ramps.length = 0;
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        destination = new FakeNode();
        createAnalyser = () => new FakeNode();
        createGain = () => new FakeNode();
        createMediaElementSource = () => new FakeNode();
        createChannelSplitter = () => new FakeNode();
        createChannelMerger = () => new FakeNode();
        currentTime = 0;
        sampleRate = 48_000;
        resume = async () => {};
      },
    );
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    a = new FakeAudio();
    b = new FakeAudio();
    p = new NavidromeProvider([a, b] as unknown as [HTMLAudioElement, HTMLAudioElement], {
      transcodeOffset: true,
      scrobble: false,
      crossfadeSec: 6,
    });
    ended = 0;
    p.on('ended', () => ended++);
    const run = p.load(track(1), { autoplay: true });
    await flush();
    a.dispatchEvent(new Event('loadedmetadata'));
    await flush();
    a.duration = 200;
    vi.useFakeTimers();
    void run;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts the next song under this one, hands over, then stops the old one', async () => {
    await p.preload(other(2), { crossfade: () => true });
    b.readyState = 4;
    a.currentTime = 190; // 10 s left: not yet
    a.fire('timeupdate');
    expect(ended).toBe(0);
    a.currentTime = 194.5; // 5.5 s left, within the 6 s fade
    a.fire('timeupdate');
    expect(ended).toBe(1);
    expect(b.paused).toBe(false);
    expect(a.paused).toBe(false);
    expect(ramps).toEqual(['curve:out', 'curve:in']);
    // The queue moved on: the hand-over keeps the old voice fading out.
    void p.load(other(2), { autoplay: true });
    expect(a.paused).toBe(false);
    expect(p.audioClock()?.positionMs).toBe(0);
    vi.advanceTimersByTime(5_800);
    expect(a.paused).toBe(true);
    expect(ramps.filter((r) => r === 'set:1')).toHaveLength(2);
  });

  it('not when the controller says no (repeat-one, the same album), nor when nothing is buffered', async () => {
    let allowed = false;
    await p.preload(other(2), { crossfade: () => allowed });
    b.readyState = 4;
    a.currentTime = 196;
    a.fire('timeupdate');
    expect(ended).toBe(0);
    allowed = true;
    b.readyState = 1; // not enough buffered: the gapless hand-over at the end instead
    a.fire('timeupdate');
    expect(ended).toBe(0);
    expect(b.paused).toBe(true);
  });

  it('a pause during the fade stops the old song at once', async () => {
    await p.preload(other(2), { crossfade: () => true });
    b.readyState = 4;
    a.currentTime = 196;
    a.fire('timeupdate');
    void p.load(other(2), { autoplay: true });
    await p.pause();
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(true);
  });

  it('a preload during the fade waits for the old voice to be free', async () => {
    await p.preload(other(2), { crossfade: () => true });
    b.readyState = 4;
    a.currentTime = 196;
    a.fire('timeupdate');
    void p.load(other(2), { autoplay: true });
    const before = a.srcSets;
    await p.preload(other(3));
    expect(a.srcSets).toBe(before);
    vi.advanceTimersByTime(5_000);
    expect(a.srcSets).toBe(before + 1);
    expect(a.src).toContain('/t3');
  });
});
