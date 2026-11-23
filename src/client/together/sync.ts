// Listen together's arithmetic (docs/TOGETHER.md), apart from the network and the player so it
// can be tested on its own: the server's clock as seen from here, where the song should be, and
// what the local player has to do to be there.

/** Further apart than this, the player seeks back into step. */
export const DRIFT_MS = 300;
/** After a correction, the player gets this long to settle before the next one. */
export const SETTLE_MS = 2500;
/** This close to the end, a player that stopped is not started again. */
export const END_SLACK_MS = 2000;

/**
 * The server's clock from this device: offset = serverTime − local time. An answer to a request
 * sent at `sentAt` and received at `receivedAt` was stamped within that window, so the midpoint is
 * right to within half the round trip; the sample with the shortest round trip of the recent ones
 * wins. A pushed event (no request) only says the offset is at least `serverTime − receivedAt`
 * (it took some time to arrive), which corrects an estimate that was too low.
 */
export function createClockSync(keep = 8) {
  let samples: { offset: number; rtt: number }[] = [];
  let best: number | null = null;
  return {
    /** An answer to a request (polling, the first fetch). */
    request(serverTime: number, sentAt: number, receivedAt: number) {
      const rtt = Math.max(0, receivedAt - sentAt);
      samples = [...samples, { offset: serverTime - (sentAt + receivedAt) / 2, rtt }].slice(-keep);
      best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
    },
    /** A pushed event: the offset is at least `serverTime − receivedAt`. */
    pushed(serverTime: number, receivedAt: number) {
      const low = serverTime - receivedAt;
      if (best === null || low > best) best = low;
    },
    /** Server time − local time; null until the first sample. */
    offset: () => best,
    toServer: (local: number) => local + (best ?? 0),
  };
}

export interface SessionClock {
  playing: boolean;
  /** Server time at 0 ms of the song (playing). */
  startedAt: number | null;
  /** Where the song is at `serverTime` (paused: where it stays). */
  positionMs: number;
  serverTime: number;
  durationMs: number;
}

/** Where the song should be at server time `serverNow`. */
export function expectedPosition(s: SessionClock, serverNow: number) {
  const raw =
    s.playing && s.startedAt !== null
      ? serverNow - s.startedAt
      : s.playing
        ? s.positionMs + (serverNow - s.serverTime)
        : s.positionMs;
  const max = s.durationMs > 0 ? s.durationMs : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(raw, max));
}

export interface LocalPlayer {
  /** The song loaded here (its Navidrome id), or null. */
  trackId: string | null;
  /** Playing or about to (loading, buffering). */
  active: boolean;
  /** Still loading: no position to compare yet. */
  loading: boolean;
  positionMs: number;
}

/**
 * Close enough while paused: within DRIFT_MS, or on the whole second before (a transcoded stream
 * can only start on whole seconds, Navidrome's `timeOffset`; it is put right on Play).
 */
const near = (local: number, target: number) =>
  Math.abs(local - target) <= DRIFT_MS || local === Math.floor(target / 1000) * 1000;

/** Time to load a song before it has to play (a cue ahead of the session). */
export const LEAD_MS = 1500;

/**
 * Where to cue the song so it starts in step: the first whole second at least LEAD_MS ahead of
 * `positionMs` (transcoded streams start on whole seconds), and how long to wait before playing
 * it. Near the end there is no room: the song starts where it is.
 */
export function cuePoint(positionMs: number, durationMs: number) {
  const at = Math.ceil((positionMs + LEAD_MS) / 1000) * 1000;
  if (durationMs > 0 && at >= durationMs - 1000) return { atMs: positionMs, waitMs: 0 };
  return { atMs: at, waitMs: at - positionMs };
}

export type Step =
  | { kind: 'load'; positionMs: number; play: boolean }
  | { kind: 'seek'; positionMs: number }
  | { kind: 'play' }
  | { kind: 'pause'; positionMs: number }
  | { kind: 'stop' }
  | null;

/**
 * What the local player does to follow the session: load the session's song at its position, play
 * or pause with it, or seek when it has drifted more than DRIFT_MS. `settling`: a correction is
 * still taking effect (no seek on top of a seek).
 */
export function plan(
  target: { trackId: string | null; playing: boolean; positionMs: number; durationMs: number },
  local: LocalPlayer,
  settling = false,
): Step {
  if (!target.trackId) return local.trackId && local.active ? { kind: 'stop' } : null;
  if (local.trackId !== target.trackId)
    return { kind: 'load', positionMs: target.positionMs, play: target.playing };
  if (local.loading) return null;
  if (!target.playing)
    return local.active || !near(local.positionMs, target.positionMs)
      ? { kind: 'pause', positionMs: target.positionMs }
      : null;
  // The song ended here a moment early (or is about to): wait for the session to move on, rather
  // than start it again.
  const ending = target.durationMs > 0 && target.positionMs >= target.durationMs - END_SLACK_MS;
  const far = Math.abs(local.positionMs - target.positionMs) > DRIFT_MS;
  // Stopped somewhere else (paused on a whole second, say): moved first, then played.
  if (!local.active)
    return ending ? null : far ? { kind: 'seek', positionMs: target.positionMs } : { kind: 'play' };
  if (ending && target.positionMs >= target.durationMs) return null;
  if (settling) return null;
  return far ? { kind: 'seek', positionMs: target.positionMs } : null;
}
