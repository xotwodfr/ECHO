import type React from 'react';
import { useCallback, useEffect, useId, useState } from 'react';
import { useStore } from 'zustand';
import { connectionStore } from '../connection.ts';
import { lineAt, nudgeLyrics } from '../lyrics/loader.ts';
import { usePlayback, usePlayer, useQueue, useTicker } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { orderedContext, upcoming } from '../playback/queue.ts';
import { lyricsStore, nextView, type StageView, scrubStore, stageView } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { Button, IconButton, PlayButton, ProviderMark } from '../ui/controls.tsx';
import { Artwork, TrackList, TrackRow } from '../ui/media.tsx';
import { Sheet } from '../ui/overlays.tsx';
import { Scrubber, Volume } from '../ui/slider.tsx';
import { Link } from './link.tsx';
import { keyTarget, type Shortcut, shortcutFor } from './shortcuts.ts';

// The transport dock (DESIGN_SYSTEM.md §5, §9.2; PRODUCT_SPEC.md §6.1): 88px, full width. Shell
// in form, Stage in colour (the progress fill and the Stage play glyph take the art palette).

const ACTIVE = ['playing', 'loading', 'buffering'];
const SEEK_MS = 5000; // ←/→ (§7)
const SEEK_FAR_MS = 15000; // Shift+←/→
const VOLUME_STEP = 0.05; // ↑/↓

export function Dock({ stage }: { stage: boolean }) {
  const c = usePlayback();
  // Everything but the position: the dock re-renders on state changes, the scrubber on its tick.
  const t = usePlayer((p) => p.track);
  const status = usePlayer((p) => p.status);
  const shuffle = usePlayer((p) => p.shuffle);
  const repeat = usePlayer((p) => p.repeat);
  const volume = usePlayer((p) => p.volume);
  const hasUpcoming = useQueue((q) => upcoming(q).length > 0);
  const [queueOpen, setQueueOpen] = useState(false);
  const idleId = useId();
  const endId = useId();
  const active = ACTIVE.includes(status);
  const toggleQueue = useCallback(() => setQueueOpen((open) => !open), []);
  useShortcuts(stage, toggleQueue);

  const idle = !t;
  // Controls with nothing to act on are disabled and point at the reason ("Nothing playing").
  const why = idle ? { disabled: true, 'aria-describedby': idleId } : {};
  // Next with nothing after this track (and repeat off) has nowhere to go.
  const atEnd = !idle && !hasUpcoming && repeat !== 'all';
  const repeatLabel = strings.dock.repeat[repeat];

  return (
    <section className="dock" aria-label={strings.dock.label} data-status={status}>
      <div className="dock-meta">
        {t ? (
          <Artwork size="dock" src={t.artwork[0]?.url} title={t.album.title} />
        ) : (
          <span className="art art--dock" aria-hidden="true" />
        )}
        <div className="dock-text">
          <p className="dock-title" id={idleId}>
            {t ? t.title : strings.dock.idle}
          </p>
          {t && (
            <p className="dock-sub">
              {t.artists.map((a) => a.name).join(', ')} —{' '}
              {t.album.id ? (
                <Link to={{ view: 'album', id: t.album.id }}>{t.album.title}</Link>
              ) : (
                t.album.title
              )}
            </p>
          )}
        </div>
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
          size="lg"
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
          label={strings.ui.next}
          icon="next"
          size="lg"
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
        <Volume value={volume} onChange={c.setVolume} />
        <IconButton
          label={strings.dock.queue}
          icon="queue"
          aria-haspopup="dialog"
          aria-expanded={queueOpen}
          onClick={() => setQueueOpen(true)}
        />
        <Reachability />
        {c.providerLabel && <ProviderMark>{c.providerLabel}</ProviderMark>}
      </div>

      <QueueSheet open={queueOpen} onClose={() => setQueueOpen(false)} />
    </section>
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
      preview={(ms) => {
        const l = lyricsStore.getState();
        return lineAt(l.doc, ms - l.offsetMs);
      }}
      disabled={!s.track || !s.capabilities.canSeek}
      disabledReason={s.track ? strings.dock.noSeek : strings.dock.idle}
    />
  );
}

/** The transport keys of PRODUCT_SPEC.md §7 (rules in shortcuts.ts). */
function useShortcuts(stage: boolean, toggleQueue: () => void) {
  const c = usePlayback();
  useEffect(() => {
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
      lyricsEarlier: () => nudgeLyrics(-1),
      lyricsLater: () => nudgeLyrics(1),
      shuffle: c.toggleShuffle,
      repeat: c.cycleRepeat,
      queue: toggleQueue,
      viewCycle: () => setView(nextView(stageView.getState().view)),
      viewCover: () => setView(stageView.getState().view === 'cover' ? 'lyrics' : 'cover'),
      viewLyrics: () => setView(stageView.getState().view === 'lyrics' ? 'visual' : 'lyrics'),
    };
    const setView = (v: StageView) => stageView.getState().set(v);
    const at = () => positionNow(c.player.getState(), performance.now());
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = shortcutFor(e, keyTarget(e.target), stage);
      if (!action) return;
      e.preventDefault();
      run[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c, stage, toggleQueue]);
}

/** S4 Queue (PRODUCT_SPEC.md §6.2): Now playing, Next up (user-added), Then (the context). */
function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = usePlayback();
  const q = useQueue((x) => x);
  const status = usePlayer((p) => p.status);
  const canEdit = usePlayer((p) => p.capabilities.canReorderQueue);
  const then = orderedContext(q);
  const total = q.nextUp.length + then.length;
  const playing = status !== 'ended' && status !== 'idle';
  const s = strings.queue;
  // Upcoming rows can be moved (Alt+↑/↓, drag, the ⋯ menu) and removed (QUE-01).
  const edit = (i: number, title: string) =>
    canEdit
      ? {
          menu: [
            ...(i > 0 ? [{ label: s.moveUp, onSelect: () => c.move(i, i - 1) }] : []),
            ...(i < total - 1 ? [{ label: s.moveDown, onSelect: () => c.move(i, i + 1) }] : []),
            { label: s.remove(title), onSelect: () => c.remove(i) },
          ],
          rowProps: {
            draggable: true,
            onDragStart: (e: React.DragEvent) =>
              e.dataTransfer.setData('text/x-echo-queue', String(i)),
            onDragOver: (e: React.DragEvent) => e.preventDefault(),
            onDrop: (e: React.DragEvent) => {
              const from = Number(e.dataTransfer.getData('text/x-echo-queue'));
              if (Number.isInteger(from)) c.move(from, i);
            },
            onKeyDown: (e: React.KeyboardEvent) => {
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              e.preventDefault();
              const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
              if (to < 0 || to >= total) return;
              c.move(i, to);
              // Focus follows the moved row once it has re-rendered.
              requestAnimationFrame(() =>
                document
                  .querySelectorAll<HTMLElement>('.sheet .queue-upcoming .track-main')
                  [to]?.focus(),
              );
            },
          },
        }
      : {};
  const row = (t: (typeof then)[number], i: number | null) => (
    <TrackRow
      key={`${t.key}-${i ?? 'now'}`}
      title={t.title}
      artist={t.artists.map((a) => a.name).join(', ')}
      durationMs={t.durationMs}
      artwork={{ src: t.artwork[0]?.url, album: t.album.title }}
      nowPlaying={i === null && playing}
      onPlay={i === null ? c.resume : () => c.jump(i)}
      {...(i === null ? {} : edit(i, t.title))}
    />
  );
  return (
    <Sheet open={open} onClose={onClose} title={s.title}>
      {/* Rows only while open: nothing to render (or re-render) behind a closed sheet. */}
      {open && !q.now && <p className="empty">{s.empty}</p>}
      {open && q.now && (
        <>
          <h3 className="sheet-section">{s.now}</h3>
          <TrackList label={s.now}>{row(q.now, null)}</TrackList>
        </>
      )}
      <div className="queue-upcoming">
        {open && q.nextUp.length > 0 && (
          <>
            <h3 className="sheet-section">{s.nextUp}</h3>
            <TrackList label={s.nextUp}>{q.nextUp.map((t, i) => row(t, i))}</TrackList>
          </>
        )}
        {open && then.length > 0 && (
          <>
            <h3 className="sheet-section">{s.rest(q.contextSource?.title)}</h3>
            <TrackList label={s.rest(q.contextSource?.title)}>
              {then.map((t, i) => row(t, q.nextUp.length + i))}
            </TrackList>
          </>
        )}
      </div>
      {open && canEdit && total > 0 && (
        <Button variant="tertiary" onClick={c.clear}>
          {s.clear}
        </Button>
      )}
    </Sheet>
  );
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
