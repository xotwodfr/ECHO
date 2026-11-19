import { createStore } from 'zustand/vanilla';
import type { QueueState, Track, TrackRef } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import type { PlaybackController, RemoteQueue } from '../playback/controller.ts';
import { upcoming } from '../playback/queue.ts';
import { positionNow } from '../playback/songClock.ts';
import { trackOf } from '../shell/mixes.ts';
import { strings } from '../strings.ts';
import { createClockSync, cuePoint, expectedPosition, plan, SETTLE_MS } from './sync.ts';

// Listen together on the web (docs/TOGETHER.md, src/server/together.ts). While in a session the
// player follows the session's song and position (sync.ts), and the transport and "Add to queue"
// go to the session instead (the controller's RemoteQueue). Updates come as Server-Sent Events,
// with polling as the fallback (and as the clock's round-trip samples).

export interface TogetherItem {
  uid: string;
  track: TrackRef;
  addedBy: { id: number; username: string };
}
export interface TogetherState {
  id: string;
  url: string;
  host: { id: number; username: string };
  you: { id: number; host: boolean; member: boolean };
  members: { id: number; username: string; host: boolean; online: boolean }[];
  now: TogetherItem | null;
  queue: TogetherItem[];
  playing: boolean;
  startedAt: number | null;
  positionMs: number;
  serverTime: number;
  version: number;
}

export type JoinOffer =
  | { id: string; state: 'loading' }
  | { id: string; state: 'ready'; host: string; members: number }
  | { id: string; state: 'other_library'; host: string }
  | { id: string; state: 'gone' | 'failed' };

export const togetherStore = createStore<{
  session: TogetherState | null;
  sheetOpen: boolean;
  starting: boolean;
  error: string | null;
  offer: JoinOffer | null;
}>()(() => ({ session: null, sheetOpen: false, starting: false, error: null, offer: null }));

/** The link a session's QR code holds: absolute, on this server. */
export const linkOf = (s: TogetherState) => new URL(s.url, location.origin).href;

/** A player's song as the server keeps it. */
export const refOf = (t: Track): TrackRef => ({
  id: t.id,
  title: t.title,
  artist: t.artists.map((a) => a.name).join(', '),
  ...(t.artists[0]?.id && { artistId: t.artists[0].id }),
  album: t.album.title,
  ...(t.album.id && { albumId: t.album.id }),
  durationMs: Math.round(t.durationMs),
  ...(t.artwork[0]?.url && { cover: t.artwork[0].url }),
});

const PENDING = 'echo.together.join';
const TICK_MS = 500;
const POLL_MS = 5000;
const POLL_FALLBACK_MS = 1500;
const CONTEXT = { kind: 'together', title: strings.together.context } as const;

/** A `/together/<id>` link opened in the browser: remembered through sign-in, then offered. */
export function takeTogetherLink(loc: Location, history: History) {
  const id = /^\/together\/([\w-]{16,64})\/?$/.exec(loc.pathname)?.[1];
  if (id) {
    try {
      sessionStorage.setItem(PENDING, id);
    } catch {}
    history.replaceState(null, '', '/');
  }
}

let started: ReturnType<typeof createFollower> | null = null;

/** Start following sessions for this signed-in user: a session they are in, a link they opened. */
export function startTogether(c: PlaybackController, notify: (m: string) => void) {
  started ??= createFollower(c, notify);
  void started.resume();
  let pending: string | null = null;
  try {
    pending = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING);
  } catch {}
  if (pending) void started.offer(pending);
  return started;
}

/** The running follower (the UI's buttons), once started. */
export const together = () => started;

function createFollower(c: PlaybackController, notify: (m: string) => void) {
  const clock = createClockSync();
  let events: EventSource | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let poll: ReturnType<typeof setTimeout> | null = null;
  let settleUntil = 0;
  let cue: { trackId: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let streamOpen = false;
  /** The queue before joining, back (paused) after leaving. */
  let before: { q: QueueState; positionMs: number } | null = null;

  const get = () => togetherStore.getState().session;

  async function fetchState(id: string) {
    const sent = Date.now();
    const s = await api<TogetherState>(`/together/${encodeURIComponent(id)}`);
    clock.request(s.serverTime, sent, Date.now());
    return s;
  }

  function apply(s: TogetherState) {
    const cur = get();
    if (cur && cur.id === s.id && s.version < cur.version) return;
    togetherStore.setState({ session: s });
    follow();
  }

  /** One step of following: compare the player with the session and correct it. */
  function follow() {
    const s = get();
    if (!s) return;
    const p = c.player.getState();
    const track = s.now?.track ?? null;
    const now = Date.now();
    const target = {
      trackId: track?.id ?? null,
      playing: s.playing,
      durationMs: track?.durationMs ?? 0,
      positionMs: track
        ? expectedPosition({ ...s, durationMs: track.durationMs }, clock.toServer(now))
        : 0,
    };
    // A cue waiting to start: leave it, unless the session moved on.
    if (cue && cue.trackId === target.trackId && target.playing) return;
    const step = plan(
      target,
      {
        trackId: p.track?.provider === 'navidrome' ? p.track.id : null,
        active: ['playing', 'loading', 'buffering'].includes(p.status),
        loading: p.status === 'loading' || p.status === 'buffering',
        positionMs: positionNow(p, performance.now()),
      },
      now < settleUntil,
    );
    if (!step) return;
    settleUntil = now + SETTLE_MS;
    if (cue) clearTimeout(cue.timer);
    cue = null;
    // Playing: cue a little ahead, paused, on a whole second, and start it when the session gets
    // there (a load takes time; a transcoded stream starts only on whole seconds).
    if ((step.kind === 'load' || step.kind === 'seek') && track && target.playing) {
      const { atMs, waitMs } = cuePoint(step.positionMs, track.durationMs);
      if (step.kind === 'load') c.together.load(trackOf(track), atMs, waitMs === 0, CONTEXT);
      else {
        if (waitMs > 0) c.together.pause();
        c.together.seek(atMs);
      }
      if (waitMs > 0) {
        const id = track.id;
        cue = {
          trackId: id,
          timer: setTimeout(() => {
            cue = null;
            if (get()?.now?.track.id === id && get()?.playing) c.together.play();
          }, waitMs),
        };
        settleUntil = now + waitMs + SETTLE_MS;
      }
    } else if (step.kind === 'load' && track)
      c.together.load(trackOf(track), step.positionMs, step.play, CONTEXT);
    else if (step.kind === 'seek') c.together.seek(step.positionMs);
    else if (step.kind === 'play') c.together.play();
    else if (step.kind === 'pause') {
      c.together.pause();
      c.together.seek(step.positionMs);
    } else if (step.kind === 'stop') c.together.pause();
  }

  function schedulePoll() {
    if (poll) clearTimeout(poll);
    const s = get();
    if (!s) return;
    poll = setTimeout(
      async () => {
        const id = get()?.id;
        if (!id) return;
        try {
          apply(await fetchState(id));
        } catch (e) {
          if (e instanceof ApiError && (e.status === 404 || e.status === 403))
            return detach('ended');
        }
        schedulePoll();
      },
      streamOpen ? POLL_MS : POLL_FALLBACK_MS,
    );
  }

  function connect(id: string) {
    events?.close();
    streamOpen = false;
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/v1/together/${encodeURIComponent(id)}/events`);
    events = es;
    es.addEventListener('open', () => {
      streamOpen = true;
    });
    es.addEventListener('state', (e) => {
      const s = JSON.parse((e as MessageEvent<string>).data) as TogetherState;
      clock.pushed(s.serverTime, Date.now());
      apply(s);
    });
    es.addEventListener('ping', (e) => {
      const p = JSON.parse((e as MessageEvent<string>).data) as {
        serverTime: number;
        version: number;
      };
      clock.pushed(p.serverTime, Date.now());
    });
    es.addEventListener('end', () => detach('ended'));
    // EventSource reconnects by itself; meanwhile polling keeps up.
    es.addEventListener('error', () => {
      streamOpen = false;
      if (es.readyState === EventSource.CLOSED && events === es) {
        events = null;
        setTimeout(() => get()?.id === id && !events && connect(id), 5000);
      }
    });
  }

  const remote: RemoteQueue = {
    toggle() {
      const s = get();
      if (!s?.you.host) return notify(strings.together.hostOnly);
      void control({ action: s.playing ? 'pause' : 'play' });
    },
    next() {
      if (!get()?.you.host) return notify(strings.together.hostOnly);
      void control({ action: 'next' });
    },
    previous() {
      if (!get()?.you.host) return notify(strings.together.hostOnly);
      void control({ action: 'previous' });
    },
    seek(ms) {
      if (!get()?.you.host) return notify(strings.together.hostOnly);
      void control({ action: 'seek', positionMs: Math.round(ms) });
    },
    add(tracks, label, next) {
      void add(tracks, label, next);
    },
    play(tracks, index) {
      const t = tracks[index];
      if (!t) return;
      const s = get();
      if (!s?.you.host) return void add([t], t.title, false);
      void (async () => {
        const after = await add([t], t.title, true, true);
        const first = after?.queue[0];
        if (after && first?.track.id === t.id && after.now?.track.id !== t.id)
          await control({ action: 'jump', uid: first.uid });
      })();
    },
    ended() {
      const s = get();
      if (s?.you.host && s.now) void control({ action: 'next', from: s.now.uid });
    },
  };

  async function control(body: Record<string, unknown>) {
    const id = get()?.id;
    if (!id) return;
    try {
      apply(
        await api<TogetherState>(`/together/${encodeURIComponent(id)}/control`, {
          method: 'POST',
          body,
        }),
      );
    } catch {}
  }

  async function add(tracks: Track[], label: string, next: boolean, quiet = false) {
    const id = get()?.id;
    if (!id) return null;
    const ours = tracks.filter((t) => t.provider === 'navidrome').slice(0, 100);
    if (!ours.length) {
      notify(strings.together.notLibrary);
      return null;
    }
    let last: TogetherState | null = null;
    try {
      // "Play next" keeps the songs' order: the last one first.
      for (const t of next ? [...ours].reverse() : ours)
        last = await api<TogetherState>(`/together/${encodeURIComponent(id)}/queue`, {
          method: 'POST',
          body: { track: refOf(t), next },
        });
    } catch {
      notify(strings.together.addFailed);
    }
    if (last) {
      apply(last);
      if (!quiet) notify(next ? strings.together.addedNext(label) : strings.together.added(label));
    }
    return last;
  }

  function attach(s: TogetherState) {
    const was = get();
    if (!was) {
      const p = c.player.getState();
      const q = c.queue.getState();
      if (!c.together.remote) before = { q, positionMs: positionNow(p, performance.now()) };
    }
    c.together.setRemote(remote);
    togetherStore.setState({ session: s, offer: null, error: null });
    if (was?.id !== s.id) connect(s.id);
    tick ??= setInterval(follow, TICK_MS);
    schedulePoll();
    follow();
  }

  function detach(why: 'ended' | 'left') {
    if (!get()) return;
    events?.close();
    events = null;
    streamOpen = false;
    if (tick) clearInterval(tick);
    if (poll) clearTimeout(poll);
    tick = poll = null;
    if (cue) clearTimeout(cue.timer);
    cue = null;
    c.together.setRemote(null);
    c.together.pause();
    togetherStore.setState({ session: null, sheetOpen: false });
    notify(why === 'ended' ? strings.together.ended : strings.together.left);
    const b = before;
    before = null;
    if (b?.q.now) c.restore(b.q, b.positionMs);
  }

  return {
    /** A session this user is already in (a reload, another tab). */
    async resume() {
      const r = await api<{ session: TogetherState | null }>('/together').catch(() => null);
      if (r?.session) attach(r.session);
    },
    /** A link was opened: say whose session it is, then Join or Not now. */
    async offer(id: string) {
      togetherStore.setState({ offer: { id, state: 'loading' } });
      try {
        const s = await fetchState(id);
        if (s.you.member) return attach(s);
        togetherStore.setState({
          offer: { id, state: 'ready', host: s.host.username, members: s.members.length },
        });
      } catch (e) {
        const host = e instanceof ApiError ? String(e.body.host ?? '') : '';
        togetherStore.setState({
          offer:
            e instanceof ApiError && e.code === 'other_library'
              ? { id, state: 'other_library', host }
              : { id, state: e instanceof ApiError && e.status === 404 ? 'gone' : 'failed' },
        });
      }
    },
    async join(id: string) {
      try {
        const sent = Date.now();
        const s = await api<TogetherState>(`/together/${encodeURIComponent(id)}/join`, {
          method: 'POST',
          body: {},
        });
        clock.request(s.serverTime, sent, Date.now());
        attach(s);
        notify(strings.together.joined(s.host.username));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'other_library')
          togetherStore.setState({
            offer: { id, state: 'other_library', host: String(e.body.host ?? '') },
          });
        else togetherStore.setState({ offer: { id, state: 'failed' } });
      }
    },
    /** Start a session on what is playing here, and show its code. */
    async start() {
      if (get()) return togetherStore.setState({ sheetOpen: true });
      togetherStore.setState({ starting: true, error: null, sheetOpen: true });
      const p = c.player.getState();
      const t = p.track?.provider === 'navidrome' ? p.track : null;
      try {
        const sent = Date.now();
        const s = await api<TogetherState>('/together', {
          method: 'POST',
          body: t
            ? {
                track: refOf(t),
                positionMs: Math.round(positionNow(p, performance.now())),
                playing: p.status === 'playing',
                // What was up next here is up next for everyone.
                queue: upcoming(c.queue.getState())
                  .filter((x) => x.provider === 'navidrome')
                  .slice(0, 100)
                  .map(refOf),
              }
            : {},
        });
        clock.request(s.serverTime, sent, Date.now());
        // The host's own player carries on where it was: nothing to load.
        settleUntil = Date.now() + SETTLE_MS;
        attach(s);
      } catch (e) {
        togetherStore.setState({
          error:
            e instanceof ApiError && e.code === 'no_library'
              ? strings.together.noLibrary
              : strings.together.failed,
        });
      } finally {
        togetherStore.setState({ starting: false });
      }
    },
    /** Leave (the host: end it for everyone). */
    async leave() {
      const s = get();
      if (!s) return;
      await api(`/together/${encodeURIComponent(s.id)}/leave`, { method: 'POST', body: {} }).catch(
        () => undefined,
      );
      detach(s.you.host ? 'ended' : 'left');
    },
    /** Host: remove any queued song; a member: their own. */
    async remove(uid: string) {
      const s = get();
      if (!s) return;
      try {
        apply(
          await api<TogetherState>(
            `/together/${encodeURIComponent(s.id)}/queue/${encodeURIComponent(uid)}`,
            { method: 'DELETE' },
          ),
        );
      } catch {}
    },
    jump: (uid: string) => control({ action: 'jump', uid }),
    play: () => control({ action: 'play' }),
  };
}
