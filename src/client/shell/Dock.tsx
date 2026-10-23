import { useId, useState } from 'react';
import { usePlayback, usePlayer, useQueue, useTicker } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { orderedContext } from '../playback/queue.ts';
import { strings } from '../strings.ts';
import { IconButton, PlayButton, ProviderMark } from '../ui/controls.tsx';
import { Artwork, TrackList, TrackRow } from '../ui/media.tsx';
import { Sheet } from '../ui/overlays.tsx';
import { Scrubber, Volume } from '../ui/slider.tsx';
import { Link } from './link.tsx';

// The transport dock (DESIGN_SYSTEM.md §5, §9.2; PRODUCT_SPEC.md §6.1): 88px, full width. Shell
// in form, Stage in colour (the progress fill and the Stage play glyph take the art palette).

const ACTIVE = ['playing', 'loading', 'buffering'];

export function Dock({ stage }: { stage: boolean }) {
  const c = usePlayback();
  const s = usePlayer((p) => p);
  const [queueOpen, setQueueOpen] = useState(false);
  const idleId = useId();
  const active = ACTIVE.includes(s.status);
  useTicker(s.status === 'playing');

  const t = s.track;
  const idle = !t;
  // Controls with nothing to act on are disabled and point at the reason ("Nothing playing").
  const why = idle ? { disabled: true, 'aria-describedby': idleId } : {};
  const repeatLabel = strings.dock.repeat[s.repeat];

  return (
    <section className="dock" aria-label={strings.dock.label} data-status={s.status}>
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
          pressed={s.shuffle}
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
          aria-busy={s.status === 'loading' || s.status === 'buffering' || undefined}
          onClick={c.toggle}
          {...why}
        />
        <IconButton label={strings.ui.next} icon="next" size="lg" onClick={c.next} {...why} />
        <IconButton
          className="dock-secondary"
          label={repeatLabel}
          icon={s.repeat === 'one' ? 'repeatOne' : 'repeat'}
          pressed={s.repeat !== 'off'}
          onClick={c.cycleRepeat}
          {...why}
        />
      </div>

      <div className="dock-scrub">
        <Scrubber
          positionMs={positionNow(s, performance.now())}
          durationMs={t?.durationMs ?? 0}
          onSeek={c.seek}
          disabled={idle || !s.capabilities.canSeek}
          disabledReason={idle ? strings.dock.idle : strings.dock.noSeek}
        />
      </div>

      <div className="dock-right">
        <Volume value={s.volume} onChange={c.setVolume} />
        <IconButton
          label={strings.dock.queue}
          icon="queue"
          aria-haspopup="dialog"
          aria-expanded={queueOpen}
          onClick={() => setQueueOpen(true)}
        />
        {c.providerLabel && <ProviderMark>{c.providerLabel}</ProviderMark>}
      </div>

      <QueueSheet open={queueOpen} onClose={() => setQueueOpen(false)} />
    </section>
  );
}

/** S4 Queue (PRODUCT_SPEC.md §6.2): Now playing, Next up (user-added), Then (the context). */
function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = usePlayback();
  const q = useQueue((x) => x);
  const status = usePlayer((p) => p.status);
  const then = orderedContext(q);
  const playing = status !== 'ended' && status !== 'idle';
  const row = (t: (typeof then)[number], i: number | null) => (
    <TrackRow
      key={`${t.key}-${i ?? 'now'}`}
      title={t.title}
      artist={t.artists.map((a) => a.name).join(', ')}
      durationMs={t.durationMs}
      artwork={{ src: t.artwork[0]?.url, album: t.album.title }}
      nowPlaying={i === null && playing}
      onPlay={i === null ? c.toggle : () => c.jump(i)}
    />
  );
  const s = strings.queue;
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
    </Sheet>
  );
}
