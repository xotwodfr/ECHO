import { randomBytes } from 'node:crypto';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { TrackRef } from '../shared/types.ts';
import { type AuthEnv, jsonObject } from './auth/routes.ts';
import type { Db } from './db/db.ts';
import type { Vars } from './http.ts';
import { navidromeUrlOf } from './navidrome/routes.ts';

// Listen together (docs/TOGETHER.md): a host starts a session and shows its link as a QR code;
// anyone signed in to this ECHO (guests too) whose Navidrome is the host's server joins from it.
// Everyone hears the same song at the same moment: the session holds the song, the server time
// it started at (or where it is paused), and a shared queue. Each member plays the song through
// their own session (/navidrome/stream/{id}); members compute the position from `startedAt` and
// the `serverTime` each answer carries.
//
// Permissions: the host plays, pauses, seeks, skips and removes anything; everyone adds songs
// (to the end, or next) and removes the ones they added. The host leaving ends the session; so do
// 12 hours without anyone doing anything. Sessions live in memory: a restart ends them.

const MIN = 60_000;
export const IDLE_MS = 12 * 60 * MIN;
/** A member neither streaming events nor asking for the state for this long has left. */
export const AWAY_MS = 30 * MIN;
/** After the song's length the server moves on by itself, unless the host's player said so first. */
export const END_GRACE_MS = 1500;
const MAX_QUEUE = 500;
const MAX_MEMBERS = 50;
const MAX_SESSIONS = 200;
const MAX_HISTORY = 50;
const PING_MS = 15_000;
const ID = /^[\w-]{22,64}$/;

interface Person {
  id: number;
  username: string;
}
export interface Item {
  uid: string;
  track: TrackRef;
  addedBy: Person;
}
interface Member extends Person {
  joinedAt: number;
  seenAt: number;
  /** Open event streams. */
  streams: number;
}
interface Session {
  id: string;
  host: Person;
  scope: string;
  createdAt: number;
  touchedAt: number;
  members: Map<number, Member>;
  now: Item | null;
  queue: Item[];
  history: Item[];
  playing: boolean;
  /** Server time at which the song was at 0 ms (playing). */
  startedAt: number;
  /** Where the song is (paused). */
  positionMs: number;
  version: number;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<(ended: boolean) => void>;
}

const text = (v: unknown, max = 500) =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
const COVER = /^\/api\/v1\/navidrome\/cover\/[^?#\s]+(\?size=\d+)?$/;

/** A song from the client (a TrackRef), checked field by field; null when it is not one. */
export function trackRefOf(v: unknown): TrackRef | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  const id = text(t.id, 200);
  const title = text(t.title);
  if (!id || !title) return null;
  const ms = typeof t.durationMs === 'number' && t.durationMs >= 0 ? Math.round(t.durationMs) : 0;
  const cover = text(t.cover);
  return {
    id,
    title,
    artist: text(t.artist) ?? '',
    ...(text(t.artistId, 200) && { artistId: t.artistId as string }),
    album: text(t.album) ?? '',
    ...(text(t.albumId, 200) && { albumId: t.albumId as string }),
    durationMs: Math.min(ms, 24 * 3_600_000),
    ...(cover && COVER.test(cover) && { cover }),
  };
}

/** The song's position at server time `t`. */
export const positionAt = (s: Pick<Session, 'playing' | 'startedAt' | 'positionMs'>, t: number) =>
  s.playing ? Math.max(0, t - s.startedAt) : s.positionMs;

export interface TogetherDeps {
  db: Db;
  now: () => number;
  publicOrigin: string | null;
  /** Timers for the song's end (tests leave them off and move the clock instead). */
  timers?: boolean;
}

export function createTogether(deps: TogetherDeps) {
  const { db, now } = deps;
  const sessions = new Map<string, Session>();
  /** Which session each user is in (one at a time). */
  const memberOf = new Map<number, string>();

  function end(s: Session) {
    if (!sessions.delete(s.id)) return;
    if (s.timer) clearTimeout(s.timer);
    for (const id of s.members.keys()) if (memberOf.get(id) === s.id) memberOf.delete(id);
    for (const l of s.listeners) l(true);
  }

  /** Moves past songs that have ended (by the clock); true when anything changed. */
  function settle(s: Session, t: number) {
    let changed = false;
    while (
      s.playing &&
      s.now &&
      s.now.track.durationMs > 0 &&
      t - s.startedAt >= s.now.track.durationMs + END_GRACE_MS
    ) {
      const ends = s.startedAt + s.now.track.durationMs + END_GRACE_MS;
      advance(s);
      if (s.playing) s.startedAt = ends;
      changed = true;
    }
    return changed;
  }

  /** The next song from 0 (the queue's first), or nothing and paused. */
  function advance(s: Session) {
    if (s.now) s.history = [...s.history, s.now].slice(-MAX_HISTORY);
    s.now = s.queue.shift() ?? null;
    s.positionMs = 0;
    s.startedAt = now();
    if (!s.now) s.playing = false;
  }

  /** A sweep on access: idle sessions end, members long gone leave. */
  function alive(id: string): Session | null {
    const s = sessions.get(id);
    if (!s) return null;
    const t = now();
    if (t - s.touchedAt >= IDLE_MS) {
      end(s);
      return null;
    }
    for (const m of s.members.values())
      if (m.id !== s.host.id && !m.streams && t - m.seenAt >= AWAY_MS) leave(s, m.id, false);
    if (settle(s, t)) changed(s, false);
    return s;
  }

  function changed(s: Session, touch = true) {
    const t = now();
    if (touch) s.touchedAt = t;
    s.version++;
    schedule(s);
    for (const l of s.listeners) l(false);
  }

  /** A timer for the song's end, so streams hear of the next song without anyone asking. */
  function schedule(s: Session) {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    if (!deps.timers || !s.playing || !s.now || s.now.track.durationMs <= 0) return;
    const wait = s.startedAt + s.now.track.durationMs + END_GRACE_MS - now();
    s.timer = setTimeout(
      () => {
        s.timer = null;
        if (sessions.get(s.id) === s && settle(s, now())) changed(s, false);
        else schedule(s);
      },
      Math.max(50, wait),
    );
    s.timer.unref?.();
  }

  function leave(s: Session, userId: number, notify = true) {
    if (userId === s.host.id) return end(s);
    s.members.delete(userId);
    if (memberOf.get(userId) === s.id) memberOf.delete(userId);
    if (notify) changed(s, false);
  }

  function join(s: Session, user: Person) {
    const t = now();
    const was = memberOf.get(user.id);
    if (was && was !== s.id) {
      const other = sessions.get(was);
      if (other) leave(other, user.id);
    }
    const m = s.members.get(user.id);
    if (m) m.seenAt = t;
    else s.members.set(user.id, { ...user, joinedAt: t, seenAt: t, streams: 0 });
    memberOf.set(user.id, s.id);
    if (!m) changed(s);
  }

  const item = (track: TrackRef, by: Person): Item => ({
    uid: randomBytes(9).toString('base64url'),
    track,
    addedBy: { id: by.id, username: by.username },
  });

  /** The session as `userId` sees it (`you`), at server time. */
  function view(s: Session, userId: number) {
    const t = now();
    const position = positionAt(s, t);
    return {
      id: s.id,
      url: `${deps.publicOrigin ?? ''}/together/${s.id}`,
      host: s.host,
      you: { id: userId, host: userId === s.host.id, member: s.members.has(userId) },
      members: [...s.members.values()].map((m) => ({
        id: m.id,
        username: m.username,
        host: m.id === s.host.id,
        online: m.streams > 0 || t - m.seenAt < 30_000,
      })),
      now: s.now,
      queue: s.queue,
      playing: s.playing,
      startedAt: s.playing ? s.startedAt : null,
      positionMs: position,
      serverTime: t,
      version: s.version,
      createdAt: s.createdAt,
    };
  }

  return {
    now,
    sessions,
    memberOf,
    alive,
    view,
    join,
    leave,
    end,
    changed,
    advance,
    item,
    scopeOf: (userId: number) => navidromeUrlOf(db, userId),
    /** A new session for `host`, starting on `track` (if given) at `positionMs`. */
    create(
      host: Person,
      scope: string,
      seed: { track: TrackRef | null; positionMs: number; playing: boolean },
    ) {
      const was = memberOf.get(host.id);
      if (was) {
        const s = sessions.get(was);
        if (s) leave(s, host.id);
      }
      if (sessions.size >= MAX_SESSIONS) return null;
      const t = now();
      const s: Session = {
        id: randomBytes(18).toString('base64url'),
        host,
        scope,
        createdAt: t,
        touchedAt: t,
        members: new Map(),
        now: seed.track ? item(seed.track, host) : null,
        queue: [],
        history: [],
        playing: !!seed.track && seed.playing,
        startedAt: t - seed.positionMs,
        positionMs: seed.track ? seed.positionMs : 0,
        version: 0,
        timer: null,
        listeners: new Set(),
      };
      sessions.set(s.id, s);
      s.members.set(host.id, { ...host, joinedAt: t, seenAt: t, streams: 0 });
      memberOf.set(host.id, s.id);
      schedule(s);
      return s;
    },
    /** Every timer stopped (tests, shutdown). */
    close() {
      for (const s of [...sessions.values()]) end(s);
    },
  };
}

export type Together = ReturnType<typeof createTogether>;

export function togetherRoutes(t: Together, requireUser: MiddlewareHandler<AuthEnv>) {
  const app = new Hono<AuthEnv & { Variables: Vars }>();
  const me = (c: Context<AuthEnv>): Person => ({
    id: c.var.user.id,
    username: c.var.user.username,
  });

  /** The session by its id, or an answer refusing it. */
  function find(c: Context<AuthEnv>, opts: { member?: boolean } = {}) {
    const id = c.req.param('id') ?? '';
    const s = ID.test(id) ? t.alive(id) : null;
    if (!s) return { no: c.json({ error: 'not_found' }, 404) } as const;
    const u = c.var.user.id;
    if (opts.member && !s.members.has(u))
      return { no: c.json({ error: 'not_member' }, 403) } as const;
    const m = s.members.get(u);
    if (m) m.seenAt = t.now();
    return { s } as const;
  }

  const answer = (c: Context<AuthEnv>, s: Session) => {
    c.header('Cache-Control', 'no-store');
    return c.json(t.view(s, c.var.user.id));
  };

  /** The session the caller is in, or null (a reload finds its way back). */
  app.get('/together', requireUser, (c) => {
    const id = t.memberOf.get(c.var.user.id);
    const s = id ? t.alive(id) : null;
    if (!s?.members.has(c.var.user.id)) return c.json({ session: null });
    return c.json({ session: t.view(s, c.var.user.id) });
  });

  /** Start a session, optionally on the song the host is playing. */
  app.post('/together', requireUser, async (c) => {
    const scope = t.scopeOf(c.var.user.id);
    if (scope === 'none') return c.json({ error: 'no_library' }, 409);
    const b = (await jsonObject(c)) ?? {};
    const track = b.track === undefined || b.track === null ? null : trackRefOf(b.track);
    if (b.track && !track) return c.json({ error: 'bad_track' }, 400);
    const pos = typeof b.positionMs === 'number' && b.positionMs >= 0 ? b.positionMs : 0;
    const s = t.create(me(c), scope, {
      track,
      positionMs: Math.min(pos, track?.durationMs || pos),
      playing: b.playing === true,
    });
    if (!s) return c.json({ error: 'too_many_sessions' }, 503);
    c.header('Cache-Control', 'no-store');
    return c.json(t.view(s, c.var.user.id), 201);
  });

  /** The session's state: for members, and for someone about to join (whose host, how many). */
  app.get('/together/:id', requireUser, (c) => {
    const f = find(c);
    if (f.no) return f.no;
    if (!f.s.members.has(c.var.user.id) && t.scopeOf(c.var.user.id) !== f.s.scope)
      return c.json({ error: 'other_library', host: f.s.host.username }, 409);
    return answer(c, f.s);
  });

  app.post('/together/:id/join', requireUser, (c) => {
    const f = find(c);
    if (f.no) return f.no;
    const s = f.s;
    if (t.scopeOf(c.var.user.id) !== s.scope)
      return c.json({ error: 'other_library', host: s.host.username }, 409);
    if (!s.members.has(c.var.user.id) && s.members.size >= MAX_MEMBERS)
      return c.json({ error: 'full' }, 409);
    t.join(s, me(c));
    return answer(c, s);
  });

  /** Leave; the host leaving ends the session for everyone. */
  app.post('/together/:id/leave', requireUser, (c) => {
    const f = find(c, { member: true });
    if (f.no) return f.no;
    t.leave(f.s, c.var.user.id);
    return c.json({ ok: true, ended: !t.sessions.has(f.s.id) });
  });

  /** Add a song: at the end, or next. Anyone in the session. */
  app.post('/together/:id/queue', requireUser, async (c) => {
    const f = find(c, { member: true });
    if (f.no) return f.no;
    const s = f.s;
    const b = await jsonObject(c);
    const track = trackRefOf(b?.track);
    if (!track) return c.json({ error: 'bad_track' }, 400);
    if (s.queue.length >= MAX_QUEUE) return c.json({ error: 'queue_full' }, 409);
    const it = t.item(track, me(c));
    if (!s.now) {
      // Nothing playing: the song starts for everyone.
      s.now = it;
      s.playing = true;
      s.startedAt = t.now();
      s.positionMs = 0;
    } else if (b?.next === true) s.queue.unshift(it);
    else s.queue.push(it);
    t.changed(s);
    return answer(c, s);
  });

  /** Remove a queued song: the host any, a member the ones they added. */
  app.delete('/together/:id/queue/:uid', requireUser, (c) => {
    const f = find(c, { member: true });
    if (f.no) return f.no;
    const s = f.s;
    const i = s.queue.findIndex((x) => x.uid === c.req.param('uid'));
    if (i < 0) return c.json({ error: 'not_found' }, 404);
    const u = c.var.user.id;
    if (u !== s.host.id && s.queue[i]?.addedBy.id !== u) return c.json({ error: 'host_only' }, 403);
    s.queue.splice(i, 1);
    t.changed(s);
    return answer(c, s);
  });

  /** The host's transport: play, pause, seek, next, previous, jump (to a queued song). */
  app.post('/together/:id/control', requireUser, async (c) => {
    const f = find(c, { member: true });
    if (f.no) return f.no;
    const s = f.s;
    if (c.var.user.id !== s.host.id) return c.json({ error: 'host_only' }, 403);
    const b = (await jsonObject(c)) ?? {};
    const at = t.now();
    const pos = positionAt(s, at);
    switch (b.action) {
      case 'play':
        if (!s.now) {
          if (!s.queue.length) return c.json({ error: 'nothing_to_play' }, 409);
          t.advance(s);
        }
        if (!s.playing) s.startedAt = at - s.positionMs;
        s.playing = true;
        break;
      case 'pause':
        s.positionMs = pos;
        s.playing = false;
        break;
      case 'seek': {
        const to = Number(b.positionMs);
        if (!s.now || !Number.isFinite(to)) return c.json({ error: 'bad_position' }, 400);
        const clamped = Math.max(0, Math.min(to, s.now.track.durationMs || to));
        s.positionMs = clamped;
        s.startedAt = at - clamped;
        break;
      }
      case 'next':
        // `from`: the song the host's player finished; a song already moved past is not skipped twice.
        if (typeof b.from === 'string' && s.now?.uid !== b.from) return answer(c, s);
        t.advance(s);
        break;
      case 'previous': {
        const prev = s.history.at(-1);
        if (pos > 3000 || !prev) {
          s.positionMs = 0;
          s.startedAt = at;
          break;
        }
        s.history = s.history.slice(0, -1);
        if (s.now) s.queue.unshift(s.now);
        s.now = prev;
        s.positionMs = 0;
        s.startedAt = at;
        break;
      }
      case 'jump': {
        const i = s.queue.findIndex((x) => x.uid === b.uid);
        if (i < 0) return c.json({ error: 'not_found' }, 404);
        const [it] = s.queue.splice(i, 1);
        if (s.now) s.history = [...s.history, s.now].slice(-MAX_HISTORY);
        s.now = it ?? null;
        s.positionMs = 0;
        s.startedAt = at;
        s.playing = true;
        break;
      }
      default:
        return c.json({ error: 'bad_action' }, 400);
    }
    t.changed(s);
    return answer(c, s);
  });

  /** Server-Sent Events: `state` on every change (and first), `ping` every 15 s, `end`. */
  app.get('/together/:id/events', requireUser, (c) => {
    const f = find(c, { member: true });
    if (f.no) return f.no;
    const s = f.s;
    const u = c.var.user.id;
    return streamSSE(c, async (stream) => {
      const m = s.members.get(u);
      if (m) m.streams++;
      let wake: (() => void) | null = null;
      let pending = true;
      let ended = false;
      const listener = (gone: boolean) => {
        pending = true;
        ended ||= gone;
        wake?.();
      };
      s.listeners.add(listener);
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      try {
        while (!closed) {
          if (ended || !t.sessions.has(s.id) || !s.members.has(u)) {
            await stream.writeSSE({ event: 'end', data: JSON.stringify({ id: s.id }) });
            break;
          }
          if (pending) {
            pending = false;
            await stream.writeSSE({ event: 'state', data: JSON.stringify(t.view(s, u)) });
          } else {
            const member = s.members.get(u);
            if (member) member.seenAt = t.now();
            await stream.writeSSE({
              event: 'ping',
              data: JSON.stringify({ serverTime: t.now(), version: s.version }),
            });
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, PING_MS);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake = null;
        }
      } finally {
        s.listeners.delete(listener);
        const member = s.members.get(u);
        if (member) {
          member.streams = Math.max(0, member.streams - 1);
          member.seenAt = t.now();
        }
      }
    });
  });

  return app;
}
