import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricsDoc, SyncLevel } from '../../shared/types.ts';
import { createResolver, jaroWinkler, normalise } from './resolve.ts';
import type { Candidate, LookupInput, Outcome, Source, SourceId } from './sources.ts';

// LI-02 selection, LI-03 match validation, LI-04 timeouts, retries, breaker, Retry-After and the
// 4.5 s answer (fake timers).

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const INPUT: LookupInput = {
  trackKey: 'navidrome:t1',
  title: 'Harbour Lights',
  artist: 'Lowfield',
  durationMs: 200_000,
  navidromeId: 't1',
};

const cand = (
  source: Candidate['source'],
  sync: SyncLevel,
  extra: Partial<Candidate> = {},
): Candidate => ({
  source,
  sync,
  offsetMs: 0,
  attribution: { text: `from ${source}` },
  lines:
    sync === 'word'
      ? [
          {
            text: 'hi',
            start: 1000,
            words: [{ text: 'hi', start: 1000, end: 1500, isPartOfWord: false }],
          },
        ]
      : [{ text: 'hi', start: sync === 'none' ? 0 : 1000 }],
  ...extra,
});

const TIMEOUT: Record<SourceId, number> = {
  navidrome: 1500,
  spicy: 4000,
  netease: 4000,
  lrclib: 4000,
  'navidrome-plain': 1500,
};
const RETRY: Record<SourceId, number | null> = {
  navidrome: 300,
  spicy: 500,
  netease: 500,
  lrclib: 500,
  'navidrome-plain': null,
};

/** A fake source: each call takes `delays[n]` ms and answers `outcomes[n]` (the last repeats). */
function fake(
  id: SourceId,
  steps: { delay: number; outcome: Outcome | 'hang' }[],
  metadataKeyed = id === 'lrclib' || id === 'navidrome-plain',
) {
  let n = 0;
  const calls = { count: 0 };
  const s: Source & { calls: typeof calls } = {
    id,
    timeoutMs: TIMEOUT[id],
    retryAfterMs: RETRY[id],
    metadataKeyed,
    eligible: () => true,
    calls,
    fetch: () => {
      calls.count++;
      const step = steps[Math.min(n++, steps.length - 1)] as (typeof steps)[number];
      return new Promise((resolve) => {
        if (step.outcome !== 'hang') setTimeout(() => resolve(step.outcome as Outcome), step.delay);
      });
    },
  };
  return s;
}
const found = (c: Candidate): Outcome => ({ kind: 'found', candidate: c });

async function settle<T>(p: Promise<T>, ms = 20_000) {
  let out: T | undefined;
  void p.then((v) => {
    out = v;
  });
  for (let t = 0; t < ms && out === undefined; t += 50) await vi.advanceTimersByTimeAsync(50);
  return out as T;
}

describe('selection (LI-02)', () => {
  it('highest sync level wins, then precedence S1 > S2 > S3 > S4', async () => {
    const r = createResolver({ random: () => 0.5 });
    const a = await settle(
      r.resolve(INPUT, [
        fake('lrclib', [{ delay: 50, outcome: found(cand('lrclib', 'line')) }]),
        fake('navidrome-plain', [{ delay: 10, outcome: found(cand('navidrome-plain', 'none')) }]),
      ]),
    );
    expect(a.doc?.source).toBe('lrclib');
    const b = await settle(
      r.resolve(INPUT, [
        fake('navidrome', [{ delay: 50, outcome: found(cand('navidrome', 'line')) }]),
        fake('lrclib', [{ delay: 10, outcome: found(cand('lrclib', 'line')) }]),
      ]),
    );
    expect(b.doc?.source).toBe('navidrome');
    const c = await settle(
      r.resolve(INPUT, [
        fake('navidrome', [{ delay: 50, outcome: found(cand('navidrome', 'line')) }]),
        fake('spicy', [{ delay: 60, outcome: found(cand('spicy', 'word')) }]),
      ]),
    );
    expect(c.doc).toMatchObject({
      source: 'spicy',
      sync: 'word',
      trackKey: 'navidrome:t1',
      version: 1,
      offsetMs: 0,
    });
  });

  it('a pin overrides both, and falls back when the pinned source has nothing', async () => {
    const r = createResolver();
    const sources = () => [
      fake('navidrome', [{ delay: 10, outcome: found(cand('navidrome', 'word')) }]),
      fake('lrclib', [{ delay: 80, outcome: found(cand('lrclib', 'line')) }]),
    ];
    expect((await settle(r.resolve(INPUT, sources(), { pin: 'lrclib' }))).doc?.source).toBe(
      'lrclib',
    );
    const none = [
      fake('navidrome', [{ delay: 10, outcome: found(cand('navidrome', 'word')) }]),
      fake('lrclib', [{ delay: 20, outcome: { kind: 'notFound' } }]),
    ];
    expect((await settle(r.resolve(INPUT, none, { pin: 'lrclib' }))).doc?.source).toBe('navidrome');
  });

  it('answers as soon as nothing pending can do better; a later, better one is a late improvement', async () => {
    const r = createResolver();
    const lrclib = fake('lrclib', [{ delay: 3000, outcome: found(cand('lrclib', 'line')) }]);
    const t0 = Date.now();
    const quick = await settle(
      r.resolve(INPUT, [
        fake('navidrome', [{ delay: 100, outcome: found(cand('navidrome', 'word')) }]),
        lrclib,
      ]),
    );
    expect(quick.doc?.source).toBe('navidrome');
    expect(Date.now() - t0).toBeLessThan(300); // did not wait for LRCLIB

    const late: LyricsDoc[] = [];
    const spicy = fake('spicy', [
      { delay: 3500, outcome: { kind: 'error', retriable: true, detail: '502' } },
      { delay: 1000, outcome: found(cand('spicy', 'word')) },
    ]);
    const first = await settle(
      r.resolve(
        { ...INPUT, spotifyId: 'x' },
        [fake('lrclib', [{ delay: 100, outcome: found(cand('lrclib', 'line')) }]), spicy],
        {
          onLate: (d) => late.push(d),
        },
      ),
    );
    expect(first.doc?.source).toBe('lrclib'); // at the 4.5 s deadline
    await vi.advanceTimersByTimeAsync(3000);
    expect(spicy.calls.count).toBe(2);
    expect(late.map((d) => [d.source, d.sync])).toEqual([['spicy', 'word']]);
  });
});

describe('match validation (LI-03)', () => {
  it('duration off by more than 3 s, or a different title, is rejected for metadata sources', async () => {
    const r = createResolver();
    const off = await settle(
      r.resolve(INPUT, [
        fake('lrclib', [
          {
            delay: 10,
            outcome: found(
              cand('lrclib', 'line', {
                reportedDurationMs: 204_000,
                matched: { title: 'Harbour Lights', artist: 'Lowfield' },
              }),
            ),
          },
        ]),
      ]),
    );
    expect(off).toMatchObject({ doc: null, tried: [{ source: 'lrclib', outcome: 'mismatch' }] });
    const near = await settle(
      r.resolve(INPUT, [
        fake('lrclib', [
          {
            delay: 10,
            outcome: found(
              cand('lrclib', 'line', {
                reportedDurationMs: 202_500,
                matched: {
                  title: 'Harbour Lights (Remastered 2019)',
                  artist: 'Lowfield feat. Someone',
                },
              }),
            ),
          },
        ]),
      ]),
    );
    expect(near.doc?.source).toBe('lrclib');
    const other = await settle(
      r.resolve(INPUT, [
        fake('lrclib', [
          {
            delay: 10,
            outcome: found(
              cand('lrclib', 'line', {
                matched: { title: 'Paper Satellites', artist: 'Lowfield' },
              }),
            ),
          },
        ]),
      ]),
    );
    expect(other.doc).toBeNull();
    // ID-keyed sources skip the text check.
    const id = await settle(
      r.resolve(INPUT, [
        fake('navidrome', [
          {
            delay: 10,
            outcome: found(
              cand('navidrome', 'line', { matched: { title: 'Totally different', artist: 'x' } }),
            ),
          },
        ]),
      ]),
    );
    expect(id.doc?.source).toBe('navidrome');
    // Spicy's end time may fall short of the track, not past it by more than 3 s.
    const spicyLong = await settle(
      r.resolve(INPUT, [
        fake('spicy', [
          { delay: 10, outcome: found(cand('spicy', 'word', { reportedDurationMs: 204_000 })) },
        ]),
      ]),
    );
    expect(spicyLong.doc).toBeNull();
  });

  it('normalisation and Jaro-Winkler', () => {
    expect(normalise('Song Title (Remastered 2011) [Live]')).toBe('song title');
    expect(normalise('Song - Radio Edit')).toBe('song');
    expect(normalise('Song feat. Other')).toBe('song');
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });
});

describe('timeouts, retries and the breaker (LI-04)', () => {
  it('a hanging source times out at its own limit; the answer never takes more than 4.5 s', async () => {
    const r = createResolver();
    const t0 = Date.now();
    const out = await settle(
      r.resolve(INPUT, [
        fake('navidrome', [{ delay: 0, outcome: 'hang' }]),
        fake('spicy', [{ delay: 0, outcome: 'hang' }]),
        fake('lrclib', [{ delay: 0, outcome: 'hang' }]),
      ]),
    );
    expect(out.doc).toBeNull();
    expect(Date.now() - t0).toBeLessThanOrEqual(4500);
    expect(out.tried).toContainEqual({ source: 'navidrome', outcome: 'timeout' });
  });

  // ON-LY-1: a source still retrying at the 4.5 s deadline was left out of `tried`, so the route saw
  // only "not found" answers and cached a miss for 3 days.
  it('a source still running at the deadline is reported as a timeout', async () => {
    const r = createResolver();
    const out = await settle(
      r.resolve(INPUT, [
        fake('navidrome', [{ delay: 10, outcome: { kind: 'notFound' } }]),
        fake('lrclib', [
          { delay: 200, outcome: { kind: 'error', retriable: true, detail: '503' } },
          { delay: 0, outcome: 'hang' }, // the retry runs past the deadline
        ]),
      ]),
    );
    expect(out.doc).toBeNull();
    expect(out.tried).toEqual([
      { source: 'navidrome', outcome: 'notFound' },
      { source: 'lrclib', outcome: 'timeout' },
    ]);
  });

  it('one retry after a network error or 5xx; none after a 4xx', async () => {
    const r = createResolver();
    const flaky = fake('lrclib', [
      { delay: 10, outcome: { kind: 'error', retriable: true, detail: '503' } },
      { delay: 10, outcome: found(cand('lrclib', 'line')) },
    ]);
    expect((await settle(r.resolve(INPUT, [flaky]))).doc?.source).toBe('lrclib');
    expect(flaky.calls.count).toBe(2);
    const denied = fake('spicy', [
      { delay: 10, outcome: { kind: 'error', retriable: false, detail: '401' } },
    ]);
    await settle(r.resolve(INPUT, [denied]));
    expect(denied.calls.count).toBe(1);
  });

  it('five failures open the breaker for 10 minutes', async () => {
    const r = createResolver();
    const down = () =>
      fake('lrclib', [{ delay: 10, outcome: { kind: 'error', retriable: true, detail: '500' } }]);
    for (let i = 0; i < 5; i++) await settle(r.resolve(INPUT, [down()]));
    const skipped = down();
    expect((await settle(r.resolve(INPUT, [skipped]))).tried).toEqual([
      { source: 'lrclib', outcome: 'skipped' },
    ]);
    expect(skipped.calls.count).toBe(0);
    expect(r.status()[0]?.source).toBe('lrclib');
    vi.advanceTimersByTime(10 * 60_000);
    const back = down();
    await settle(r.resolve(INPUT, [back]));
    expect(back.calls.count).toBeGreaterThan(0);
  });

  it('429 with Retry-After: the source cools for that long, without a retry', async () => {
    const r = createResolver();
    const limited = fake('spicy', [
      {
        delay: 10,
        outcome: { kind: 'error', retriable: false, retryAfterMs: 30_000, detail: '429' },
      },
    ]);
    await settle(r.resolve(INPUT, [limited]));
    expect(limited.calls.count).toBe(1);
    const again = fake('spicy', [{ delay: 10, outcome: found(cand('spicy', 'word')) }]);
    expect((await settle(r.resolve(INPUT, [again]))).tried).toEqual([
      { source: 'spicy', outcome: 'skipped' },
    ]);
    vi.advanceTimersByTime(30_000);
    expect((await settle(r.resolve(INPUT, [again]))).doc?.source).toBe('spicy');
  });

  it('a candidate that fails repair is invalid, not chosen', async () => {
    const r = createResolver();
    const empty = fake('navidrome', [
      {
        delay: 10,
        outcome: found(cand('navidrome', 'line', { lines: [{ text: ' ', start: 0 }] })),
      },
    ]);
    expect(await settle(r.resolve(INPUT, [empty]))).toMatchObject({
      doc: null,
      tried: [{ source: 'navidrome', outcome: 'invalid' }],
    });
  });
});
