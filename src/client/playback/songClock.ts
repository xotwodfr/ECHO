import type { PlaybackState } from '../../shared/types.ts';

// SongClock (TECHNICAL_ARCHITECTURE.md §5.2): song time for the Stage and the lyric field. It runs
// on performance.now() between observations, so it is smooth every frame. When the provider can
// read its audio element, every call re-anchors on `audio.currentTime`: errors under 80 ms are
// slewed out (10% per 60 Hz frame), larger ones (a seek, a stall) snap. The output latency is
// subtracted, so `now()` is what the listener hears. The user's lyric offset is added by the lyric
// field (LYR-25, M6), because visual features use the un-offset clock.

/** The position now, extrapolated from the last observation while playing. */
export function positionNow(s: PlaybackState, now: number) {
  const live = s.status === 'playing' ? s.positionMs + (now - s.positionAt) : s.positionMs;
  return Math.min(Math.max(0, live), s.track?.durationMs ?? 0);
}

export const SNAP_MS = 80;
export const SLEW_PER_FRAME = 0.1;
const FRAME_MS = 1000 / 60;

/** What a provider with real audio reports: the element's position and the output latency. */
export interface AudioClock {
  positionMs: number;
  latencyMs: number;
}

export function createSongClock(
  state: () => PlaybackState,
  audio: () => AudioClock | null,
  perfNow: () => number,
) {
  let est = Number.NaN;
  let at = 0;
  let key: string | null = null;
  let held = Number.NaN; // the value while not playing
  return {
    now(): number {
      const s = state();
      const t = perfNow();
      const playing = s.status === 'playing';
      const a = playing || s.status === 'paused' ? audio() : null;
      const target = a ? a.positionMs : positionNow(s, t);
      const trackKey = s.track?.key ?? null;
      // Not playing: time holds still. Only a new position (a seek while paused, another track)
      // moves it; the output latency estimate drifts a little and must not (LYR-17).
      if (!playing) {
        if (Number.isNaN(held) || trackKey !== key || target !== est)
          held = Math.max(0, target - (a?.latencyMs ?? 0));
        est = target;
        at = t;
        key = trackKey;
        return held;
      }
      held = Number.NaN;
      if (playing) est += t - at;
      const error = target - est;
      if (!playing || trackKey !== key || !(Math.abs(error) < SNAP_MS)) est = target;
      else est += error * (1 - (1 - SLEW_PER_FRAME) ** ((t - at) / FRAME_MS));
      at = t;
      key = trackKey;
      return Math.max(0, est - (a?.latencyMs ?? 0));
    },
  };
}

export type SongClock = ReturnType<typeof createSongClock>;
