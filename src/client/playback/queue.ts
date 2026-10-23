import type { PlayContext, ProviderId, QueueState, Track } from '../../shared/types.ts';

// Queue operations (PLAYBACK_ARCHITECTURE.md §6), pure. `context` always keeps the source's order;
// with shuffle on, `shuffleOrder` lists context indices in play order. So shuffle touches the
// context only, `nextUp` keeps its order, and turning shuffle off restores the original order.

export const HISTORY_MAX = 50;

export const emptyQueue = (): QueueState => ({
  provider: null,
  now: null,
  nextUp: [],
  context: [],
  history: [],
});

/** Seeded PRNG (mulberry32), so shuffles are reproducible in tests. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function permutation(n: number, random: () => number) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

/** The context in play order. */
export const orderedContext = (q: QueueState) =>
  q.shuffleOrder ? q.shuffleOrder.map((i) => q.context[i] as Track) : q.context;

/** Everything that will play after `now`, in order. */
export const upcoming = (q: QueueState) => [...q.nextUp, ...orderedContext(q)];

const pushHistory = (history: Track[], t: Track | null) =>
  t ? [...history, t].slice(-HISTORY_MAX) : history;

/** Removes context entries by index, keeping shuffleOrder consistent. */
function withoutContext(q: QueueState, drop: Set<number>): QueueState {
  const context = q.context.filter((_, i) => !drop.has(i));
  // new index of old index i = i − (number of dropped indices below i)
  const shift = (i: number) => i - [...drop].filter((d) => d < i).length;
  const shuffleOrder = q.shuffleOrder?.filter((i) => !drop.has(i)).map(shift);
  return { ...q, context, ...(q.shuffleOrder ? { shuffleOrder } : {}) };
}

/**
 * Play `tracks` from `index` (an album, playlist or result list). With shuffle, the rest of the
 * list plays in random order; otherwise the tracks after `index` follow. `nextUp` is kept.
 */
export function startContext(
  q: QueueState,
  tracks: Track[],
  index: number,
  source: PlayContext,
  provider: ProviderId,
  shuffle: boolean,
  random: () => number,
): QueueState {
  const now = tracks[index] ?? null;
  const context = shuffle ? tracks.filter((_, i) => i !== index) : tracks.slice(index + 1);
  return {
    provider,
    now,
    nextUp: q.provider === provider ? q.nextUp : [],
    context,
    contextSource: source,
    history: pushHistory(q.history, q.now),
    ...(shuffle ? { shuffleOrder: permutation(context.length, random) } : {}),
  };
}

/** §6.2: nextUp first, then the context (in shuffle order). Null when nothing is left. */
export function advance(q: QueueState): QueueState | null {
  const history = pushHistory(q.history, q.now);
  const [first, ...rest] = q.nextUp;
  if (first) return { ...q, now: first, nextUp: rest, history };
  const at = q.shuffleOrder ? q.shuffleOrder[0] : 0;
  if (at === undefined || q.context[at] === undefined) return null;
  return { ...withoutContext(q, new Set([at])), now: q.context[at], history };
}

/** Previous track from history; the current one goes back to the front of what plays next. */
export function back(q: QueueState): QueueState | null {
  const prev = q.history.at(-1);
  if (!prev) return null;
  const context = q.now ? [q.now, ...q.context] : q.context;
  const shuffleOrder = q.shuffleOrder && [
    ...(q.now ? [0] : []),
    ...q.shuffleOrder.map((i) => i + (q.now ? 1 : 0)),
  ];
  return {
    ...q,
    now: prev,
    context,
    history: q.history.slice(0, -1),
    ...(shuffleOrder ? { shuffleOrder } : {}),
  };
}

export const playNext = (q: QueueState, t: Track): QueueState => ({
  ...q,
  nextUp: [t, ...q.nextUp],
});
export const addToQueue = (q: QueueState, t: Track): QueueState => ({
  ...q,
  nextUp: [...q.nextUp, t],
});

export function setShuffle(q: QueueState, on: boolean, random: () => number): QueueState {
  const { shuffleOrder: _, ...rest } = q;
  return on ? { ...rest, shuffleOrder: permutation(q.context.length, random) } : rest;
}

/**
 * Jump to an upcoming track (a click in the queue sheet). `index` is its position in `upcoming()`.
 * The tracks between `now` and it are skipped: they leave the queue and do not enter history.
 */
export function jump(q: QueueState, index: number): QueueState | null {
  const history = pushHistory(q.history, q.now);
  if (index < q.nextUp.length) {
    return { ...q, now: q.nextUp[index] as Track, nextUp: q.nextUp.slice(index + 1), history };
  }
  const p = index - q.nextUp.length;
  const order = q.shuffleOrder ?? q.context.map((_, i) => i);
  const target = order[p];
  if (target === undefined) return null;
  return {
    ...withoutContext(q, new Set(order.slice(0, p + 1))),
    now: q.context[target] as Track,
    nextUp: [],
    history,
  };
}
