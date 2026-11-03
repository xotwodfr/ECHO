import type React from 'react';
import { useRef, useState } from 'react';
import { usePlayback, usePlayer, useQueue } from '../playback/context.tsx';
import { orderedContext } from '../playback/queue.ts';
import { strings } from '../strings.ts';
import { Button } from '../ui/controls.tsx';
import { TrackList, TrackRow } from '../ui/media.tsx';
import { occurrenceKeys, useFlip } from '../ui/motion.ts';
import { ConfirmDialog, Sheet } from '../ui/overlays.tsx';

// S4 Queue (PRODUCT_SPEC.md §6.2): Now playing, Next up (user-added), Then (the context). In the
// right panel on wide screens, a sheet on phones.

export function QueueList({ scope }: { scope: string }) {
  const c = usePlayback();
  const q = useQueue((x) => x);
  const status = usePlayer((p) => p.status);
  const canEdit = usePlayer((p) => p.capabilities.canReorderQueue);
  const then = orderedContext(q);
  const total = q.nextUp.length + then.length;
  const playing = status !== 'ended' && status !== 'idle';
  const [clearing, setClearing] = useState(false);
  const s = strings.queue;
  // Rows keep who they are through moves (a song can be queued twice), so they glide (§11).
  const keys = occurrenceKeys([...q.nextUp, ...then].map((t) => t.key));
  const upcoming = useRef<HTMLDivElement>(null);
  useFlip(upcoming, keys.join('|'));
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
              // Only our own rows: anything else dropped here ('' → 0) would move the first track.
              const raw = e.dataTransfer.getData('text/x-echo-queue');
              const from = Number(raw);
              if (raw !== '' && Number.isInteger(from)) c.move(from, i);
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
                  .querySelectorAll<HTMLElement>(`${scope} .queue-upcoming .track-main`)
                  [to]?.focus(),
              );
            },
          },
        }
      : {};
  const row = (t: (typeof then)[number], i: number | null) => (
    <TrackRow
      key={i === null ? 'now' : keys[i]}
      flipKey={i === null ? undefined : keys[i]}
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
    <>
      {!q.now && <p className="empty">{s.empty}</p>}
      {q.now && (
        <>
          <h3 className="sheet-section">{s.now}</h3>
          <TrackList label={s.now}>{row(q.now, null)}</TrackList>
        </>
      )}
      <div className="queue-upcoming" ref={upcoming}>
        {q.nextUp.length > 0 && (
          <>
            <h3 className="sheet-section">{s.nextUp}</h3>
            <TrackList label={s.nextUp}>{q.nextUp.map((t, i) => row(t, i))}</TrackList>
          </>
        )}
        {then.length > 0 && (
          <>
            <h3 className="sheet-section">{s.rest(q.contextSource?.title)}</h3>
            <TrackList label={s.rest(q.contextSource?.title)}>
              {then.map((t, i) => row(t, q.nextUp.length + i))}
            </TrackList>
          </>
        )}
      </div>
      {/* Destructive, with confirmation (DESIGN_SYSTEM.md §9). */}
      {canEdit && total > 0 && (
        <Button variant="destructive" onClick={() => setClearing(true)}>
          {s.clear}
        </Button>
      )}
      <ConfirmDialog
        open={clearing}
        title={s.clearTitle}
        consequence={s.clearConsequence(total)}
        confirmLabel={s.clear}
        onConfirm={() => {
          setClearing(false);
          c.clear();
        }}
        onCancel={() => setClearing(false)}
      />
    </>
  );
}

/** Phones: the queue as a sheet. Rows only while open: nothing to render behind a closed sheet. */
export function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={strings.queue.title}>
      {open && <QueueList scope=".sheet" />}
    </Sheet>
  );
}
