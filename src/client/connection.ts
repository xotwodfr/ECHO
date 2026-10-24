import { createStore } from 'zustand/vanilla';

// Reachability of the ECHO server and of the user's Navidrome (PRODUCT_SPEC.md §8, J6;
// ACCEPTANCE_CRITERIA.md REL-01): a failure starts probing with backoff (1, 2, 4 … 30 s), and the
// first probe that answers clears the state. Audio already buffered keeps playing meanwhile.

export type Reach = { down: false } | { down: true; retryAt: number };

export const connectionStore = createStore<{ server: Reach; navidrome: Reach }>()(() => ({
  server: { down: false },
  navidrome: { down: false },
}));

const MAX_MS = 30_000;
const probes = {
  server: async () => (await fetch('/api/v1/health', { cache: 'no-store' })).ok,
  // The proxy answers 502 while the user's Navidrome cannot be reached.
  navidrome: async () =>
    (await fetch('/api/v1/navidrome/rest/ping', { credentials: 'same-origin' })).status !== 502,
};
const running = { server: false, navidrome: false };

export function reportDown(which: 'server' | 'navidrome') {
  if (running[which]) return;
  running[which] = true;
  let wait = 1000;
  const attempt = async () => {
    let ok = false;
    try {
      ok = await probes[which]();
    } catch {}
    if (ok) {
      running[which] = false;
      connectionStore.setState({ [which]: { down: false } });
      return;
    }
    connectionStore.setState({ [which]: { down: true, retryAt: Date.now() + wait } });
    setTimeout(attempt, wait);
    wait = Math.min(MAX_MS, wait * 2);
  };
  void attempt(); // probes first: a one-off failure that answers at once shows nothing
}
