import type { QueueState } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import type { PlaybackController } from './controller.ts';
import { positionNow } from './controller.ts';

// The queue follows the user (IMPLEMENTATION_PLAN.md M5 task 9): restored at start, saved to the
// server a moment after it changes and every 15 s while playing. Another device's newer queue
// shows a notice; it replaces this one unless this one is playing.

const SAVE_DEBOUNCE_MS = 2000;
const SAVE_EVERY_MS = 15_000;
/** Request bodies are capped at 64 KB (SETTINGS_AND_SECURITY.md §5.6). */
const MAX_BYTES = 60_000;

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

export async function startQueueSync(c: PlaybackController, notify: (message: string) => void) {
  let base = 0;
  // An unreachable server (a restart) is asked again, 1, 2, 4 … 30 s apart; a refusal (not signed
  // in) means the queue does not follow this session.
  for (let wait = 1000; ; wait = Math.min(30_000, wait * 2)) {
    try {
      const saved = await api<{ queue: QueueState | null; positionMs: number; updatedAt: number }>(
        '/me/queue',
      );
      base = saved.updatedAt;
      if (saved.queue?.now && !c.player.getState().track) c.restore(saved.queue, saved.positionMs);
      break;
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) return;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  async function save(keepalive = false) {
    timer = null;
    // Spotify keeps its own queue across devices; the saved queue stays the library's.
    if (c.queue.getState().provider === 'spotify') return;
    const p = c.player.getState();
    const body = {
      queue: trimQueue(c.queue.getState()),
      positionMs: positionNow(p, performance.now()),
      baseUpdatedAt: base,
    };
    try {
      base = (await api<{ updatedAt: number }>('/me/queue', { method: 'PUT', body, keepalive }))
        .updatedAt;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) return;
      notify('Your queue changed on another device.');
      const newer = await api<{ queue: QueueState | null; positionMs: number; updatedAt: number }>(
        '/me/queue',
      );
      base = newer.updatedAt;
      // The device that is playing keeps its queue (and wins on its next save).
      if (p.status !== 'playing' && newer.queue) c.restore(newer.queue, newer.positionMs);
    }
  }
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };
  c.queue.subscribe(later);
  setInterval(() => c.player.getState().status === 'playing' && later(), SAVE_EVERY_MS);
  // Leaving the page: the pending save goes out even as the page unloads.
  addEventListener('pagehide', () => timer && void save(true));
}
