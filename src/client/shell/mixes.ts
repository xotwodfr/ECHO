import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Mix, PlayedContext, Track, TrackRef, Wrapped } from '../../shared/types.ts';
import { api } from '../api.ts';
import type { PlaybackController } from '../playback/controller.ts';

// ECHO's own play history (src/server/plays.ts): a Navidrome song played to Navidrome's scrobble
// point (half of it, or four minutes) is recorded, and Made For You, Jump back in and Wrapped are
// made from those plays on the server.

const POINT_MS = 4 * 60_000;
const SHORTEST_MS = 30_000; // shorter songs are not counted (Last.fm's rule too)
const TICK_MS = 5000;

/** Only a user's own Navidrome library has a history; fixtures and Spotify do not. */
let enabled = false;

export function startHistory(c: PlaybackController, on: boolean) {
  enabled = on;
  if (!on) return () => undefined;
  let key: string | null = null;
  let last = 0;
  let counted = false;
  const timer = setInterval(() => {
    const s = c.player.getState();
    const t = s.track;
    if (t?.provider !== 'navidrome') return;
    const at = s.positionMs + (s.status === 'playing' ? performance.now() - s.positionAt : 0);
    // A new song, or this one again from its start (repeat one, Previous).
    if (t.key !== key || at < last - 2 * TICK_MS) {
      key = t.key;
      counted = false;
    }
    last = at;
    if (counted || s.status !== 'playing' || t.durationMs < SHORTEST_MS) return;
    if (at < Math.min(t.durationMs / 2, POINT_MS)) return;
    counted = true;
    const context = c.queue.getState().contextSource;
    void api('/me/plays', { method: 'POST', body: { track: t, context } }).catch(() => undefined);
  }, TICK_MS);
  return () => clearInterval(timer);
}

/** A song from the history as the player plays it. */
export const trackOf = (r: TrackRef): Track => ({
  key: `navidrome:${r.id}`,
  provider: 'navidrome',
  id: r.id,
  title: r.title,
  artists: [{ ...(r.artistId && { id: r.artistId }), name: r.artist }],
  album: {
    ...(r.albumId && { id: r.albumId }),
    title: r.album,
    key: `navidrome:${r.albumId ?? r.id}`,
  },
  durationMs: r.durationMs,
  artwork: r.cover ? [{ url: r.cover }] : [],
});

const made = createStore<{ mixes: Mix[] | 'error' | null }>()(() => ({ mixes: null }));
let loading = false;

/** Fetched again on each Home or mix page (the server keeps them a day); shown as they were meanwhile. */
function refreshMixes() {
  if (!enabled) return made.setState({ mixes: [] });
  if (loading) return;
  loading = true;
  api<{ mixes: Mix[] }>(`/me/mixes?tz=${new Date().getTimezoneOffset()}`)
    .then(
      (r) => made.setState({ mixes: r.mixes }),
      () => made.setState((s) => ({ mixes: Array.isArray(s.mixes) ? s.mixes : 'error' })),
    )
    .finally(() => {
      loading = false;
    });
}

export function useMixes() {
  useEffect(refreshMixes, []);
  return useStore(made, (s) => s.mixes);
}

/** Jump back in: what was played from lately; nothing while it loads or when it cannot. */
export function useJumpBackIn() {
  const [contexts, setContexts] = useState<PlayedContext[]>([]);
  useEffect(() => {
    if (!enabled) return;
    api<{ contexts: PlayedContext[] }>('/me/plays/contexts').then(
      (r) => setContexts(r.contexts),
      () => undefined,
    );
  }, []);
  return contexts;
}

export function useWrapped(year: number) {
  const [w, setW] = useState<Wrapped | 'error' | null>(null);
  useEffect(() => {
    setW(null);
    api<Wrapped>(`/me/wrapped?year=${year}`).then(setW, () => setW('error'));
  }, [year]);
  return w;
}
