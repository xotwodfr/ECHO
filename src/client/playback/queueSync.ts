import { createStore } from 'zustand/vanilla';
import type { QueueState, Track } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import { sessionExpired } from '../session.ts';
import type { PlaybackController } from './controller.ts';
import { positionNow } from './controller.ts';

// The queue follows the user (IMPLEMENTATION_PLAN.md M5 task 9): restored at start, saved to the
// server a moment after it changes and every 15 s while playing. Another device's newer queue
// shows a notice; it replaces this one unless this one is playing.

/** Navidrome was disconnected and the page is about to reload: no save may bring its queue back. */
export const queueSyncStopped = createStore<{ stopped: boolean }>()(() => ({ stopped: false }));

const SAVE_DEBOUNCE_MS = 2000;
const SAVE_EVERY_MS = 15_000;
/** Request bodies are capped at 64 KB (SETTINGS_AND_SECURITY.md §5.6). */
const MAX_BYTES = 60_000;

/**
 * A saved queue as this player needs it. Another client may leave out what is empty or default
 * (the Android app omits `nextUp: []` and `provider: 'navidrome'`), which crashed the web on load.
 */
export function savedQueue(q: QueueState): QueueState {
  const track = <T extends Track | null | undefined>(t: T): T =>
    t
      ? ({
          ...t,
          provider: t.provider ?? 'navidrome',
          artists: t.artists ?? [],
          artwork: t.artwork ?? [],
        } as T)
      : t;
  const list = (l: Track[] | undefined) => (Array.isArray(l) ? l.map(track) : []);
  return {
    ...q,
    provider: q.provider === undefined ? 'navidrome' : q.provider,
    now: track(q.now),
    nextUp: list(q.nextUp),
    context: list(q.context),
    history: list(q.history),
  };
}

/** The queue, trimmed until it fits: history first, then the far end of the context. */
export function trimQueue(q: QueueState): QueueState {
  let out: QueueState = { ...q, history: q.history.slice(-20) };
  const size = () => new Blob([JSON.stringify(out)]).size;
  while (size() > MAX_BYTES && out.context.length > 0) {
    // Shuffle positions point into the context; they no longer fit once it is cut.
    const { shuffleOrder: _, ...rest } = out;
    out = { ...rest, context: out.context.slice(0, Math.floor(out.context.length / 2)) };
  }
  while (size() > MAX_BYTES && out.nextUp.length > 0)
    out = { ...out, nextUp: out.nextUp.slice(0, Math.floor(out.nextUp.length / 2)) };
  return out;
}

type Slot = '/me/queue' | '/me/queue/youtube';
type Saved = { queue: QueueState | null; positionMs: number; updatedAt: number };

/**
 * Where a queue is saved: one with any YouTube song still to play goes to the web-only slot, so
 * the Android app (which reads `/me/queue` and plays Navidrome alone) never restores one (spec
 * call 16). The history does not count: a Navidrome album after a YouTube session is Android's.
 */
export function queueSlot(q: QueueState): Slot {
  const ahead = [q.now, ...q.nextUp, ...q.context];
  return ahead.some((t) => t?.provider === 'youtube') ? '/me/queue/youtube' : '/me/queue';
}

/** What a slot keeps: `/me/queue` without YouTube songs, even in its history. */
const forSlot = (q: QueueState, slot: Slot): QueueState =>
  slot === '/me/queue' ? { ...q, history: q.history.filter((t) => t.provider !== 'youtube') } : q;

export async function startQueueSync(c: PlaybackController, notify: (message: string) => void) {
  const base: Record<Slot, number> = { '/me/queue': 0, '/me/queue/youtube': 0 };
  // An unreachable server (a restart) is asked again, 1, 2, 4 … 30 s apart; a refusal (not signed
  // in) means the queue does not follow this session. Both slots are read; the newer one plays.
  for (let wait = 1000; ; wait = Math.min(30_000, wait * 2)) {
    try {
      const [nav, yt] = await Promise.all([
        api<Saved>('/me/queue'),
        api<Saved>('/me/queue/youtube'),
      ]);
      base['/me/queue'] = nav.updatedAt;
      base['/me/queue/youtube'] = yt.updatedAt;
      const saved = yt.queue?.now && yt.updatedAt > nav.updatedAt ? yt : nav;
      if (saved.queue?.now && !c.player.getState().track)
        c.restore(savedQueue(saved.queue), saved.positionMs);
      break;
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) return;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  async function save(keepalive = false) {
    timer = null;
    // The session ended: whoever signs in next must not receive this queue (REL-05).
    if (sessionExpired.getState().expired || queueSyncStopped.getState().stopped) return;
    const p = c.player.getState();
    const all = trimQueue(c.queue.getState());
    const slot = queueSlot(all);
    const queue = forSlot(all, slot);
    const body = {
      queue,
      positionMs: positionNow(p, performance.now()),
      baseUpdatedAt: base[slot],
    };
    try {
      base[slot] = (
        await api<{ updatedAt: number }>(slot, { method: 'PUT', body, keepalive })
      ).updatedAt;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) return;
      notify('Your queue changed on another device.');
      const newer = await api<Saved>(slot);
      base[slot] = newer.updatedAt;
      // The device that is playing keeps its queue (and wins on its next save).
      if (p.status !== 'playing' && newer.queue)
        c.restore(savedQueue(newer.queue), newer.positionMs);
    }
  }
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };
  c.queue.subscribe(later);
  // Play, pause and seek move the saved position without changing the queue (QUE-05). A seek is a
  // jump in position; the regular position updates are not.
  c.player.subscribe((s, prev) => {
    const now = performance.now();
    if (s.status !== prev.status || Math.abs(positionNow(s, now) - positionNow(prev, now)) > 2000)
      later();
  });
  setInterval(() => c.player.getState().status === 'playing' && later(), SAVE_EVERY_MS);
  // Leaving the page: the pending save goes out even as the page unloads.
  addEventListener('pagehide', () => timer && void save(true));
}
