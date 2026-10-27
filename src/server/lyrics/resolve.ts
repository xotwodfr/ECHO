import type { LyricsDoc, SyncLevel } from '../../shared/types.ts';
import { LyricsInvalid, repair } from './parse.ts';
import type { Candidate, LookupInput, Outcome, Source, SourceId } from './sources.ts';

// The lyric resolver (LYRICS_INTEGRATION.md §4, §6): all eligible sources in parallel, each with
// its own timeout and at most one jittered retry on a network error or 5xx (never on 4xx); a
// circuit breaker per source; 429 Retry-After honoured as "cooling"; match validation; selection by
// pin, then sync level, then precedence. It answers as soon as no pending source could do better,
// and within 4.5 s regardless; a better candidate that arrives later is passed to `onLate`.

export const PRECEDENCE: SourceId[] = [
  'navidrome',
  'spicy',
  'netease',
  'lrclib',
  'navidrome-plain',
];
/** The best a source can return, so the resolver knows when waiting is pointless. */
const CEILING: Record<SourceId, SyncLevel> = {
  navidrome: 'word',
  spicy: 'word',
  netease: 'word',
  lrclib: 'line',
  'navidrome-plain': 'none',
};
const LEVEL: Record<SyncLevel, number> = { word: 2, line: 1, none: 0 };
export const DEADLINE_MS = 4500;
const BREAKER_FAILURES = 5;
const BREAKER_MS = 10 * 60_000;

export type Tried = {
  source: SourceId;
  outcome: 'found' | 'notFound' | 'error' | 'timeout' | 'invalid' | 'mismatch' | 'skipped';
};

export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}
const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// ---- matching (§3, §4.2) ----------------------------------------------------------------------

/** For comparison only: lower case, NFKC, no "feat." credits or bracketed / dashed qualifiers. */
export function normalise(s: string) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*(remaster|edit|version|live|mix|mono|stereo).*$/i, '')
    .replace(/\s+(feat\.?|ft\.?|with)\s+.*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Jaro-Winkler similarity, 0..1. */
export function jaroWinkler(a: string, b: string) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++)
      if (!bm[j] && a[i] === b[j]) {
        am[i] = bm[j] = true;
        matches++;
        break;
      }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++)
    if (am[i]) {
      while (!bm[k]) k++;
      if (a[i] !== b[k]) t++;
      k++;
    }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** §4.2: duration within 3 s (Spicy: its end within the track + 3 s); text for metadata sources. */
export function matches(c: Candidate, input: LookupInput, metadataKeyed: boolean) {
  if (c.reportedDurationMs !== undefined && input.durationMs !== undefined) {
    const ok =
      c.source === 'spicy'
        ? c.reportedDurationMs <= input.durationMs + 3000
        : Math.abs(c.reportedDurationMs - input.durationMs) <= 3000;
    if (!ok) return false;
  }
  if (metadataKeyed && c.matched) {
    if (jaroWinkler(normalise(c.matched.title), normalise(input.title)) < 0.85) return false;
    const primary = (s: string) => normalise(s.split(/,|&| and | x /i)[0] ?? s);
    if (jaroWinkler(primary(c.matched.artist), primary(input.artist)) < 0.8) return false;
  }
  return true;
}

const rank = (sync: SyncLevel, source: SourceId) =>
  LEVEL[sync] * 10 + (PRECEDENCE.length - PRECEDENCE.indexOf(source));

// ---- the resolver -----------------------------------------------------------------------------

export function createResolver(opts: { clock?: Clock; random?: () => number } = {}) {
  const clock = opts.clock ?? realClock;
  const random = opts.random ?? Math.random;
  const failures = new Map<SourceId, number>();
  const openUntil = new Map<SourceId, number>();

  const sleep = (ms: number) => new Promise<void>((r) => clock.setTimeout(r, ms));

  /** One attempt with the source's timeout. */
  function attempt(s: Source, input: LookupInput): Promise<Outcome | 'timeout'> {
    const ctl = new AbortController();
    return new Promise((resolve) => {
      const timer = clock.setTimeout(() => {
        ctl.abort();
        resolve('timeout');
      }, s.timeoutMs);
      s.fetch(input, ctl.signal).then(
        (o) => {
          clock.clearTimeout(timer);
          resolve(o);
        },
        (err: unknown) => {
          clock.clearTimeout(timer);
          resolve(
            err instanceof LyricsInvalid
              ? { kind: 'error', retriable: false, detail: 'invalid' }
              : { kind: 'error', retriable: true, detail: String(err) },
          );
        },
      );
    });
  }

  /** Attempts, the retry, and the breaker's bookkeeping. */
  async function run(
    s: Source,
    input: LookupInput,
  ): Promise<{ tried: Tried; candidate?: Candidate }> {
    let o = await attempt(s, input);
    const retriable =
      o === 'timeout' || (o.kind === 'error' && o.retriable && o.retryAfterMs === undefined);
    if (retriable && s.retryAfterMs !== null && o !== 'timeout') {
      await sleep(s.retryAfterMs * (0.7 + 0.6 * random()));
      o = await attempt(s, input);
    }
    if (o === 'timeout' || (o.kind === 'error' && (o.retriable || o.retryAfterMs !== undefined))) {
      if (o !== 'timeout' && o.retryAfterMs !== undefined)
        openUntil.set(s.id, clock.now() + o.retryAfterMs); // cooling
      else {
        const n = (failures.get(s.id) ?? 0) + 1;
        failures.set(s.id, n);
        if (n >= BREAKER_FAILURES) {
          openUntil.set(s.id, clock.now() + BREAKER_MS);
          failures.set(s.id, 0);
        }
      }
      return { tried: { source: s.id, outcome: o === 'timeout' ? 'timeout' : 'error' } };
    }
    failures.set(s.id, 0);
    if (o.kind === 'error') return { tried: { source: s.id, outcome: 'error' } };
    if (o.kind === 'notFound') return { tried: { source: s.id, outcome: 'notFound' } };
    if (!matches(o.candidate, input, s.metadataKeyed))
      return { tried: { source: s.id, outcome: 'mismatch' } };
    try {
      return {
        tried: { source: s.id, outcome: 'found' },
        candidate: { ...o.candidate, ...repair(o.candidate, input.durationMs) },
      };
    } catch {
      return { tried: { source: s.id, outcome: 'invalid' } };
    }
  }

  return {
    /** Sources skipped by the breaker or cooling, with when they come back (Admin → Server → Lyrics). */
    status() {
      const now = clock.now();
      return [...openUntil]
        .filter(([, until]) => until > now)
        .map(([source, until]) => ({ source, until }));
    },

    resolve(
      input: LookupInput,
      sources: Source[],
      o: { pin?: SourceId; onLate?: (doc: LyricsDoc) => void } = {},
    ): Promise<{ doc: LyricsDoc | null; tried: Tried[] }> {
      const now = clock.now();
      const tried: Tried[] = [];
      const live = sources.filter((s) => {
        if (!s.eligible(input)) return false;
        if ((openUntil.get(s.id) ?? 0) > now) {
          tried.push({ source: s.id, outcome: 'skipped' });
          return false;
        }
        return true;
      });
      const found: Candidate[] = [];
      const pending = new Set(live.map((s) => s.id));
      const toDoc = (c: Candidate): LyricsDoc => ({
        version: 1,
        trackKey: input.trackKey,
        sync: c.sync,
        source: c.source,
        attribution: c.attribution,
        offsetMs: 0,
        lines: c.lines,
        fetchedAt: new Date(clock.now()).toISOString(),
        ...(c.language && { language: c.language }),
        ...(input.durationMs !== undefined && { durationMs: input.durationMs }),
        ...(c.agents && { agents: c.agents }),
        ...(c.translations && { translations: c.translations }),
      });
      const sourceOf = (c: Candidate): SourceId =>
        c.source === 'fixture' ? 'navidrome' : (c.source as SourceId);
      const best = () => {
        if (o.pin) {
          const pinned = found.find((c) => sourceOf(c) === o.pin);
          if (pinned) return pinned;
        }
        return [...found].sort((a, b) => rank(b.sync, sourceOf(b)) - rank(a.sync, sourceOf(a)))[0];
      };
      // Could a source still running beat what we have?
      const settled = () => {
        const b = best();
        if (o.pin && pending.has(o.pin)) return false;
        if (!b) return pending.size === 0;
        if (o.pin && sourceOf(b) === o.pin) return true;
        const have = rank(b.sync, sourceOf(b));
        return [...pending].every((id) => rank(CEILING[id], id) <= have);
      };

      return new Promise((answer) => {
        let delivered: Candidate | undefined;
        let done = false;
        const finish = (atDeadline = false) => {
          if (done) return;
          done = true;
          clock.clearTimeout(deadline);
          delivered = best();
          // Sources still running at the deadline timed out, as far as this answer goes: listed, so
          // a miss is never cached while one of them might still have the lyrics.
          const late = atDeadline
            ? [...pending].map((source): Tried => ({ source, outcome: 'timeout' }))
            : [];
          answer({ doc: delivered ? toDoc(delivered) : null, tried: [...tried, ...late] });
        };
        const deadline = clock.setTimeout(() => finish(true), DEADLINE_MS);
        if (!live.length) return finish();
        for (const s of live)
          void run(s, input).then((r) => {
            pending.delete(s.id);
            tried.push(r.tried);
            if (r.candidate) found.push(r.candidate);
            if (!done) {
              if (settled()) finish();
              return;
            }
            // Answered already: a better candidate is a late improvement (cached; the stage
            // decides whether to swap, LYRICS_EXPERIENCE.md §9.5).
            const b = best();
            if (
              b &&
              b !== delivered &&
              (!delivered || rank(b.sync, sourceOf(b)) > rank(delivered.sync, sourceOf(delivered)))
            ) {
              delivered = b;
              o.onLate?.(toDoc(b));
            }
          });
      });
    },
  };
}

export type Resolver = ReturnType<typeof createResolver>;
