import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { PlaybackState, QueueState } from '../../shared/types.ts';
import { type Libraries, sourceStore } from '../source.ts';
import type { PlaybackController } from './controller.ts';

export const PlaybackContext = createContext<{
  controller: PlaybackController;
  libraries: Libraries;
} | null>(null);

function usePlaybackContext() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error('outside <PlaybackContext>');
  return ctx;
}

export const usePlayback = () => usePlaybackContext().controller;
const noop = () => () => {};
const zero = () => 0;

/** The active source's library (source.ts), re-rendering when it loads more or the switch flips. */
export function useLibrary() {
  const source = useStore(sourceStore, (s) => s.source);
  const library = usePlaybackContext().libraries[source];
  useSyncExternalStore(library?.subscribe ?? noop, library?.version ?? zero);
  return library;
}

export function usePlayer<T>(select: (s: PlaybackState) => T): T {
  return useStore(usePlayback().player, select);
}

export function useQueue<T>(select: (s: QueueState) => T): T {
  return useStore(usePlayback().queue, select);
}

/**
 * Re-renders every `ms` while `active`, so time-derived UI (the scrubber) moves. UI clock only:
 * it is a timer, not requestAnimationFrame, and browsers throttle it in hidden tabs.
 */
export function useTicker(active: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
