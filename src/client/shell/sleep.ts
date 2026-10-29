import { createStore } from 'zustand/vanilla';
import type { PlaybackController } from '../playback/controller.ts';
import { strings } from '../strings.ts';
import { toastStore } from '../ui/logic.ts';

// Spotify's sleep timer: pause after some minutes, or when the current track ends.

export type SleepChoice = number | 'track';
export const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60] as const;

export const sleepStore = createStore<{ choice: SleepChoice | null; endsAt: number | null }>()(
  () => ({ choice: null, endsAt: null }),
);

let timer: ReturnType<typeof setTimeout> | undefined;
let offTrack: (() => void) | undefined;

function clear() {
  clearTimeout(timer);
  offTrack?.();
  offTrack = undefined;
  sleepStore.setState({ choice: null, endsAt: null });
}

const fire = (c: PlaybackController) => {
  clear();
  if (c.player.getState().status === 'playing') c.toggle();
  toastStore.getState().show(strings.sleep.stopped);
};

export function setSleep(c: PlaybackController, choice: SleepChoice | null) {
  clear();
  if (choice === null) return toastStore.getState().show(strings.sleep.cancelled);
  if (choice === 'track') {
    const key = c.player.getState().track?.key;
    // The next track starting (or the queue ending) is the end of this one.
    offTrack = c.player.subscribe((s) => {
      if (s.track?.key !== key || s.status === 'ended') fire(c);
    });
    sleepStore.setState({ choice, endsAt: null });
  } else {
    timer = setTimeout(() => fire(c), choice * 60_000);
    sleepStore.setState({ choice, endsAt: Date.now() + choice * 60_000 });
  }
  toastStore.getState().show(strings.sleep.set(sleepLabel(choice)));
}

export const sleepLabel = (choice: SleepChoice) =>
  choice === 'track'
    ? strings.sleep.endOfTrack
    : choice === 60
      ? strings.sleep.hour
      : strings.sleep.minutes(choice);
