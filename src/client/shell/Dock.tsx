import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { connectionStore } from '../connection.ts';
import { lineAt, nudgeLyrics } from '../lyrics/loader.ts';
import { usePlayback, usePlayer, useQueue, useTicker } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { upcoming } from '../playback/queue.ts';
import {
  lyricOffset,
  lyricsStore,
  nextView,
  type StageView,
  scrubStore,
  stageView,
} from '../stage/status.ts';
import { strings } from '../strings.ts';
import { IconButton, PlayButton } from '../ui/controls.tsx';
import { Artwork } from '../ui/media.tsx';
import { useCoverChange } from '../ui/motion.ts';
import { Menu, Sheet } from '../ui/overlays.tsx';
import { Scrubber, Volume } from '../ui/slider.tsx';
import { collections, setStar } from './collections.ts';
import { useCompact, useWide } from './compact.ts';
import { dropTracks } from './drag.ts';
import { HeartButton } from './hearts.tsx';
import { Link, useView } from './link.tsx';
import { panels, toggleRight } from './panels.ts';
import { QueueSheet } from './Queue.tsx';
import { toggleFullscreen } from './StageViews.tsx';
import { keyTarget, type Shortcut, shortcutFor } from './shortcuts.ts';
import { SLEEP_MINUTES, setSleep, sleepLabel, sleepStore } from './sleep.ts';

// The player (DESIGN_SYSTEM.md §5, §9.2; PRODUCT_SPEC.md §6.1), after Spotify's: the song and its
// heart, the transport over the progress bar, and the view buttons (Now Playing, lyrics, queue,
// sleep timer, volume). It floats over the page as an M3 floating toolbar; on phones it is the
// mini player above the tab bar, opening the Now Playing view.

const ACTIVE = ['playing', 'loading', 'buffering'];
const SEEK_MS = 5000; // ←/→ (§7)
const SEEK_FAR_MS = 15000; // Shift+←/→
const VOLUME_STEP = 0.05; // ↑/↓

export function Dock({ stage }: { stage: boolean }) {
  const c = usePlayback();
  // Everything but the position: the dock re-renders on state changes, the scrubber on its tick.
  const t = usePlayer((p) => p.track);
  const dockRef = useRef<HTMLElement>(null);
  useCoverChange(dockRef, t?.key);
  const status = usePlayer((p) => p.status);
  const shuffle = usePlayer((p) => p.shuffle);
  const repeat = usePlayer((p) => p.repeat);
  const volume = usePlayer((p) => p.volume);
  const hasUpcoming = useQueue((q) => upcoming(q).length > 0);
  const right = useStore(panels, (s) => s.right);
  const navigate = useView((s) => s.navigate);
  const compact = useCompact();
  // The queue lives in the right panel where there is one; elsewhere it is a sheet.
  const sheet = !useWide() || stage;
  const [queueOpen, setQueueOpen] = useState(false);
  const idleId = useId();
  const endId = useId();
  const active = ACTIVE.includes(status);
  // Q: the queue in the right panel on wide screens, a sheet on phones and over the lyrics view.
  const toggleQueue = useCallback(() => {
    if (sheet) setQueueOpen((open) => !open);
    else toggleRight('queue');
  }, [sheet]);
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  useShortcuts(stage, toggleQueue, openHelp);

  const idle = !t;
  // Controls with nothing to act on are disabled and point at the reason ("Nothing playing").
  const why = idle ? { disabled: true, 'aria-describedby': idleId } : {};
  // Next with nothing after this track (and repeat off) has nowhere to go.
  const atEnd = !idle && !hasUpcoming && repeat !== 'all';
  const repeatLabel = strings.dock.repeat[repeat];
  // The lyrics view opens from here, and closes back to where it was opened from.
  const toggleListen = () => (stage ? history.back() : navigate({ view: 'listen' }));

  return (
    <section className="dock" ref={dockRef} aria-label={strings.dock.label} data-status={status}>
      <div className="dock-meta">
        {/* Phones: the mini player opens the Now Playing view; the whole strip is its target. */}
        {compact && !stage && t && (
          <Link
            className="dock-open"
            to={{ view: 'listen' }}
            aria-label={`${strings.nav.listen}: ${t.title}`}
          />
        )}
        {t ? (
          <Artwork key={t.key} size="dock" src={t.artwork[0]?.url} title={t.album.title} />
        ) : (
          <span className="art art--dock" aria-hidden="true" />
        )}
        <div className="dock-text">
          <p className="dock-title" id={idleId}>
            {t ? (
              t.album.id && t.provider === 'navidrome' ? (
                <Link to={{ view: 'album', id: t.album.id }}>{t.title}</Link>
              ) : (
                t.title
              )
            ) : (
              strings.dock.idle
            )}
          </p>
          {t && (
            <p className="dock-sub">
              {/* Artists with an id lead to their page (S6). */}
              {t.artists.map((a, i) => (
                <span key={a.id ?? a.name}>
                  {i > 0 && ', '}
                  {a.id && t.provider === 'navidrome' ? (
                    <Link to={{ view: 'artist', id: a.id }}>{a.name}</Link>
                  ) : (
                    a.name
                  )}
                </span>
              ))}
            </p>
          )}
        </div>
        {/* A YouTube song playing in Navidrome mode (spec call 17): no Navidrome links or heart. */}
        {t?.provider === 'navidrome' && <HeartButton track={t} />}
      </div>

      <div className="dock-transport">
        <IconButton
          className="dock-secondary"
          label={strings.ui.shuffle}
          icon="shuffle"
          pressed={shuffle}
          onClick={c.toggleShuffle}
          {...why}
        />
        <IconButton
          className="dock-prev"
          label={strings.ui.previous}
          icon="previous"
          onClick={c.previous}
          {...why}
        />
        <PlayButton
          playing={active}
          stage={stage}
          aria-busy={status === 'loading' || status === 'buffering' || undefined}
          onClick={c.toggle}
          {...why}
        />
        <IconButton
          className="dock-next"
          label={strings.ui.next}
          icon="next"
          onClick={c.next}
          {...why}
          {...(atEnd ? { disabled: true, 'aria-describedby': endId } : {})}
        />
        {atEnd && (
          <span className="visually-hidden" id={endId}>
            {strings.dock.endOfQueue}
          </span>
        )}
        <IconButton
          className="dock-secondary"
          label={repeatLabel}
          icon={repeat === 'one' ? 'repeatOne' : 'repeat'}
          pressed={repeat !== 'off'}
          onClick={c.cycleRepeat}
          {...why}
        />
      </div>

      <div className="dock-scrub">
        <DockScrubber />
      </div>

      <div className="dock-right">
        <Reachability />
        {!stage && (
          <IconButton
            className="dock-wide"
            label={strings.panel.nowPlaying}
            icon="nowPlaying"
            pressed={right === 'nowPlaying'}
            onClick={() => toggleRight('nowPlaying')}
          />
        )}
        <IconButton
          label={strings.nowPlaying.lyrics}
          icon="mic"
          pressed={stage}
          onClick={toggleListen}
        />
        <IconButton
          label={strings.dock.queue}
          icon="queue"
          aria-haspopup={sheet ? 'dialog' : undefined}
          pressed={sheet ? undefined : right === 'queue'}
          aria-expanded={sheet ? queueOpen : undefined}
          onClick={toggleQueue}
          {...dropTracks((t) => c.addToQueue(t, t[0]?.title ?? ''))}
        />
        <SleepMenu />
        <Volume value={volume} onChange={c.setVolume} />
        {stage && (
          <IconButton
            label={strings.stage.fullscreen}
            icon="fullscreen"
            onClick={toggleFullscreen}
          />
        )}
      </div>

      <QueueSheet open={queueOpen} onClose={() => setQueueOpen(false)} />
      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title={strings.prefs.keyboard}>
        {helpOpen && (
          <dl className="keymap">
            {strings.prefs.keys.map(([keys, action]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        )}
      </Sheet>
    </section>
  );
}

/** Spotify's sleep timer, from the player (a moon that turns green while it runs). */
function SleepMenu() {
  const c = usePlayback();
  const choice = useStore(sleepStore, (s) => s.choice);
  const s = strings.sleep;
  return (
    <span className="dock-sleep" data-on={choice !== null || undefined}>
      <Menu
        label={choice === null ? s.title : `${s.title}: ${sleepLabel(choice)}`}
        icon="moon"
        items={[
          ...SLEEP_MINUTES.map((m) => ({ label: sleepLabel(m), onSelect: () => setSleep(c, m) })),
          { label: s.endOfTrack, onSelect: () => setSleep(c, 'track') },
          ...(choice !== null ? [{ label: s.off, onSelect: () => setSleep(c, null) }] : []),
        ]}
      />
    </span>
  );
}

/** The scrubber is the only part that moves with time, so only it re-renders on the tick. */
function DockScrubber() {
  const c = usePlayback();
  const s = usePlayer((p) => p);
  useTicker(s.status === 'playing');
  return (
    <Scrubber
      positionMs={positionNow(s, performance.now())}
      durationMs={s.track?.durationMs}
      onSeek={c.seek}
      onScrub={(ms) => scrubStore.setState({ ms })}
      preview={(ms) => lineAt(lyricsStore.getState().doc, ms - lyricOffset())}
      disabled={!s.track || !s.capabilities.canSeek}
      disabledReason={s.track ? strings.dock.noSeek : strings.dock.idle}
    />
  );
}

/** The transport keys of PRODUCT_SPEC.md §7 (rules in shortcuts.ts). */
function useShortcuts(stage: boolean, toggleQueue: () => void, openHelp: () => void) {
  const c = usePlayback();
  const navigate = useView((s) => s.navigate);
  useEffect(() => {
    let gAt = Number.NEGATIVE_INFINITY; // when G was pressed (G-sequences last 1.5 s)
    const run: Record<Shortcut, () => void> = {
      toggle: c.toggle,
      seekBack: () => c.seek(at() - SEEK_MS),
      seekForward: () => c.seek(at() + SEEK_MS),
      seekBackFar: () => c.seek(at() - SEEK_FAR_MS),
      seekForwardFar: () => c.seek(at() + SEEK_FAR_MS),
      previous: c.previous,
      next: () => c.hasNext() && c.next(),
      volumeUp: () => c.setVolume(c.player.getState().volume + VOLUME_STEP),
      volumeDown: () => c.setVolume(c.player.getState().volume - VOLUME_STEP),
      mute: c.toggleMute,
      like: () => {
        const t = c.player.getState().track;
        if (!t) return;
        const s = collections.getState().starred;
        const on = !!s && s !== 'error' && s.tracks.some((x) => x.id === t.id);
        void setStar('track', t, !on);
      },
      lyricsEarlier: () => nudgeLyrics(-1),
      lyricsLater: () => nudgeLyrics(1),
      shuffle: c.toggleShuffle,
      repeat: c.cycleRepeat,
      queue: toggleQueue,
      viewCycle: () => setView(nextView(stageView.getState().view)),
      viewCover: () => setView(stageView.getState().view === 'cover' ? 'lyrics' : 'cover'),
      viewLyrics: () => setView(stageView.getState().view === 'lyrics' ? 'visual' : 'lyrics'),
      goPrefix: () => {
        gAt = performance.now();
      },
      goLibrary: () => navigate({ view: 'library', tab: 'albums' }),
      goSettings: () => navigate({ view: 'settings', section: 'preferences' }),
      goListen: () => navigate({ view: 'listen' }),
      fullscreen: toggleFullscreen,
      help: openHelp,
    };
    const setView = (v: StageView) => stageView.getState().set(v);
    const at = () => positionNow(c.player.getState(), performance.now());
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const afterG = performance.now() - gAt < 1500;
      const action = shortcutFor(e, keyTarget(e.target), stage, afterG);
      // A modal sheet or dialog makes the page behind it inert, but its keys bubble here all the
      // same: only the keys that close a sheet (Q, ?) still act. One playing its exit is gone.
      const modal = document.querySelector('dialog:modal:not([data-leaving])');
      if (modal && action !== 'queue' && action !== 'help') return;
      if (afterG && action !== 'goPrefix') gAt = Number.NEGATIVE_INFINITY;
      if (!action) return;
      e.preventDefault();
      run[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c, stage, toggleQueue, openHelp, navigate]);
}

/** "Navidrome unreachable — retrying in 4 s" (PRODUCT_SPEC.md J6), while something is down. */
function Reachability() {
  const { server, navidrome } = useStore(connectionStore);
  const down = server.down ? server : navidrome.down ? navidrome : null;
  useTicker(!!down, 500);
  if (!down?.down) return null;
  const s = Math.max(0, Math.ceil((down.retryAt - Date.now()) / 1000));
  return (
    <p className="dock-reach" role="status">
      {strings.dock.unreachable(server.down ? 'ECHO server' : 'Navidrome', s)}
    </p>
  );
}
