import { createStore } from 'zustand/vanilla';
import type { Track } from '../../shared/types.ts';
import { api } from '../api.ts';
import { prefsStore, setPref } from '../prefs.ts';
import { strings } from '../strings.ts';
import type { NavidromeProvider } from './navidrome.ts';
import * as Q from './queue.ts';

// Karaoke mode on the web (docs/KARAOKE.md), as on Android: while it's on, the server is asked
// about the song playing (made first, every 5 s until ready) and the next two (made next, once a
// minute each); each karaoke file is handed to the player when ready, which switches to it at the
// same position. The vocals level goes straight to the audio graph's mix.

export type KaraokeStatus =
  | 'off'
  | 'unavailable'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'tooLong'
  | 'downmixed';

export interface KaraokeState {
  /** Whether the server has a stem service (null: not asked yet). */
  server: boolean | null;
  status: KaraokeStatus;
  /** Songs before the one playing while it's prepared. */
  ahead: number;
}

export const karaokeStore = createStore<KaraokeState>()(() => ({
  server: null,
  status: 'off',
  ahead: 0,
}));

type Answer = {
  status: 'off' | 'queued' | 'working' | 'ready' | 'failed' | 'skipped';
  ahead?: number;
  url?: string;
};

/** The karaoke files the server has ready, by track key. */
const ready = new Map<string, string>();
/** Answers that won't change this session (ready, failed, too long), by track key. */
const settled = new Map<string, Answer['status']>();
const asked = new Map<string, number>();

/** The karaoke file to play for `t`, while Karaoke mode is on and the server has it. */
export function karaokeSrc(t: Track): string | null {
  return prefsStore.getState().playback.karaoke ? (ready.get(t.key) ?? null) : null;
}

export const statusOf = (s: Answer['status']): KaraokeStatus =>
  s === 'ready'
    ? 'ready'
    : s === 'failed'
      ? 'failed'
      : s === 'skipped'
        ? 'tooLong'
        : s === 'off'
          ? 'unavailable'
          : 'preparing';

async function ask(t: Track, soon: boolean): Promise<Answer | null> {
  const a = await api<Answer>(`/karaoke/${encodeURIComponent(t.id)}${soon ? '?soon=1' : ''}`).catch(
    () => null,
  );
  if (!a) return null;
  if (a.status === 'ready' && a.url) ready.set(t.key, a.url);
  if (a.status === 'ready' || a.status === 'failed' || a.status === 'skipped')
    settled.set(t.key, a.status);
  if (a.status === 'off') karaokeStore.setState({ server: false });
  return a;
}

/** Karaoke mode on or off on this device. */
export const setKaraoke = (on: boolean) => void setPref('playback', 'karaoke', on);
export const setVocalLevel = (v: number) =>
  void setPref('playback', 'vocalLevel', Math.min(1, Math.max(0, v)));

/** A song's menu → Make karaoke version: made next on the server; the notice says where it is. */
export async function requestKaraoke(t: Track, notify: (m: string) => void, onReady?: () => void) {
  const r = strings.karaoke.requested;
  if (t.provider !== 'navidrome') return notify(strings.karaoke.unavailable);
  const a = await ask(t, false);
  if (!a) return notify(r.error);
  if (a.status === 'ready') onReady?.();
  notify(
    a.status === 'ready'
      ? r.ready(t.title)
      : a.status === 'failed'
        ? r.failed(t.title)
        : a.status === 'skipped'
          ? r.tooLong(t.title)
          : a.status === 'off'
            ? r.off
            : (a.ahead ?? 0) === 0
              ? r.now(t.title)
              : r.queued(t.title, a.ahead ?? 0),
  );
}

/** The songs with a karaoke version ready, newest first (Home's shelf), as Subsonic songs. */
export async function readyKaraokeSongs(limit = 30) {
  return (await api<{ songs: Record<string, unknown>[] }>(`/karaoke/ready?limit=${limit}`)).songs;
}

/** Marks songs as ready (Home's shelf knows they are), so they play as karaoke from the first note. */
export function markReady(tracks: Track[]) {
  for (const t of tracks) {
    const url = `/api/v1/karaoke/${encodeURIComponent(t.id)}/audio`;
    ready.set(t.key, url);
    settled.set(t.key, 'ready');
  }
}

/** Starts following the player: asks the server, swaps sources, applies the level, watches for downmixing. */
export function startKaraoke(
  controller: {
    player: { getState(): { track: Track | null; status: string } };
    queue: { getState(): import('../../shared/types.ts').QueueState };
  },
  provider: NavidromeProvider,
  notify: (m: string) => void,
) {
  let silentFor = 0;
  let warned = false;
  let downmixed = false;
  const applyLevel = () => provider.setVocalLevel(prefsStore.getState().playback.vocalLevel);
  applyLevel();
  prefsStore.subscribe((s, prev) => {
    if (s.playback.vocalLevel !== prev.playback.vocalLevel) applyLevel();
    if (s.playback.karaoke !== prev.playback.karaoke) {
      void provider.refreshSource();
      void tick();
    }
  });

  async function tick() {
    const on = prefsStore.getState().playback.karaoke;
    const t = controller.player.getState().track;
    if (!on || !t) return karaokeStore.setState({ status: 'off' });
    if (karaokeStore.getState().server === null) {
      const k = await api<{ enabled: boolean }>('/karaoke').catch(() => null);
      if (!k) return;
      karaokeStore.setState({ server: k.enabled });
    }
    if (!karaokeStore.getState().server || t.provider !== 'navidrome')
      return karaokeStore.setState({ status: 'unavailable' });
    // A karaoke file whose rears stay exactly empty for 20 s while its fronts play: the browser
    // downmixed it (an instrumental intro leaves a faint residue there, never digital silence).
    if (provider.karaokeDownmixed()) silentFor++;
    else silentFor = 0;
    if (silentFor >= 20 && !downmixed) {
      downmixed = true;
      if (!warned) {
        warned = true;
        notify(strings.karaoke.downmixed);
      }
    }
    const now = Date.now();
    const due = (k: string, every: number) => !settled.has(k) && (asked.get(k) ?? 0) + every <= now;
    let answer: Answer | null = null;
    if (due(t.key, 5000)) {
      asked.set(t.key, now);
      answer = await ask(t, false);
    }
    const st = settled.get(t.key);
    const status = st
      ? statusOf(st)
      : answer
        ? statusOf(answer.status)
        : karaokeStore.getState().status;
    karaokeStore.setState({
      status: status === 'ready' && downmixed ? 'downmixed' : status,
      ahead: answer?.ahead ?? (st ? 0 : karaokeStore.getState().ahead),
    });
    if (st === 'ready' && !provider.playingKaraoke) void provider.refreshSource();
    for (const n of Q.upcoming(controller.queue.getState()).slice(0, 2))
      if (n.provider === 'navidrome' && due(n.key, 60_000)) {
        asked.set(n.key, now);
        await ask(n, true);
        if (settled.get(n.key) === 'ready') void provider.refreshSource();
      }
  }

  const loop = async () => {
    await tick().catch(() => {});
    setTimeout(loop, 1000);
  };
  void loop();
}
