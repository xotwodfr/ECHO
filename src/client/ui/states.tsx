import { Component, type ReactNode, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { connectionStore } from '../connection.ts';
import { useTicker } from '../playback/context.tsx';
import { strings } from '../strings.ts';
import { Button } from './controls.tsx';
import { AlbumGrid, AlbumTileSkeleton, TrackList, TrackRowSkeleton } from './media.tsx';

// The block states of DESIGN_SYSTEM.md §10 (DS-07): loading is the final layout in flat bars, an
// error stays inside its block with what failed, the last good time and Retry, and empty is one
// sentence and one action. Offline keeps what was loaded, with a freshness note.

const t = strings.states;
const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { timeStyle: 'short' });

export function BlockError({
  what,
  lastGood,
  onRetry,
}: {
  what: string;
  lastGood?: number | null;
  onRetry?: () => void;
}) {
  return (
    <div className="block-error" role="alert">
      <p>
        {what}
        {lastGood ? ` ${t.lastGood(time(lastGood))}` : ''}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t.retry}
        </Button>
      )}
    </div>
  );
}

/** The last resort: a render error anywhere replaces the app with a reload, not a blank page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-error">
        <div className="block-error" role="alert">
          <p>{t.appFailed}</p>
          <Button variant="secondary" onClick={() => location.reload()}>
            {t.reload}
          </Button>
        </div>
      </main>
    );
  }
}

/**
 * No answer from the server at start (a restart behind Caddy, ON-UI-1): instead of an empty shell,
 * this says so, asks again with backoff (1, 2, 4 … 30 s) and reloads once `/session` answers (REL-01).
 * Only a good answer reloads, so a server that answers with errors cannot cause a reload loop.
 */
export function ServerUnreachable() {
  const [retryAt, setRetryAt] = useState(Date.now() + 1000);
  useTicker(true, 500);
  useEffect(() => {
    let wait = 1000;
    let timer = setTimeout(function attempt() {
      void fetch('/api/v1/session', { credentials: 'same-origin', cache: 'no-store' })
        .then(
          (r) => r.ok,
          () => false,
        )
        .then((ok) => {
          if (ok) return location.reload();
          wait = Math.min(30_000, wait * 2);
          setRetryAt(Date.now() + wait);
          timer = setTimeout(attempt, wait);
        });
    }, wait);
    return () => clearTimeout(timer);
  }, []);
  const s = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  return (
    <main className="app-error">
      <div className="block-error" role="alert">
        <p>{strings.dock.unreachable('ECHO server', s)}</p>
        <Button variant="secondary" onClick={() => location.reload()}>
          {t.retry}
        </Button>
      </div>
    </main>
  );
}

export function BlockEmpty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="block-empty">
      <p className="empty">{text}</p>
      {action}
    </div>
  );
}

/** Album tiles at their real size while the list loads. */
export function GridLoading({ count = 12 }: { count?: number }) {
  return (
    <AlbumGrid>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders
        <AlbumTileSkeleton key={i} />
      ))}
    </AlbumGrid>
  );
}

/** Track rows at their real size while a list loads. */
export function RowsLoading({
  label,
  count = 6,
  media = false,
}: {
  label: string;
  count?: number;
  media?: boolean;
}) {
  return (
    <TrackList label={label}>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders
        <TrackRowSkeleton key={i} media={media} />
      ))}
    </TrackList>
  );
}

/** "Navidrome unreachable: showing what was loaded at 14:02" while the library is kept from memory. */
export function FreshnessNote({ loadedAt }: { loadedAt: number | null | undefined }) {
  const { navidrome } = useStore(connectionStore);
  if (!navidrome.down || !loadedAt) return null;
  return (
    <p className="freshness" role="status">
      {t.stale(time(loadedAt))}
    </p>
  );
}

/** A Settings block while it loads: its heading and flat bars where its rows will be. */
export function SectionLoading({ title, rows = 2 }: { title: string; rows?: number }) {
  return (
    <section className="connection" aria-busy="true" aria-label={title}>
      <h3>{title}</h3>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders
        <span key={i} className="bar bar--body" aria-hidden="true" />
      ))}
    </section>
  );
}
