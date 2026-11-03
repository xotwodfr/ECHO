import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Track } from '../../shared/types.ts';
import type { YtLyrics } from '../../shared/youtube.ts';
import { usePlayback, usePlayer, useQueue } from '../playback/context.tsx';
import { upcoming } from '../playback/queue.ts';
import { Stage } from '../shell/Stage.tsx';
import { LyricsView } from '../shell/StageViews.tsx';
import { lyricsStore } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { IconButton } from '../ui/controls.tsx';
import { ytLyrics } from './api.ts';
import { itemOfTrack, PageState, Row, Shelves, Thumb, useYtPage } from './parts.tsx';

// YouTube Music's own full-screen player (spec: the owner chose it over ECHO's Stage): big artwork
// beside three tabs, Up next, Lyrics and Related. It covers the page, not the player bar, so the
// transport stays where it was. Esc or the chevron closes it.

const y = strings.youtube;
type Tab = 'next' | 'lyrics' | 'related';

export function NowPlaying({ onClose }: { onClose: () => void }) {
  const t = usePlayer((p) => p.track);
  const [tab, setTab] = useState<Tab>('next');
  const close = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  if (!t) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'next', label: y.upNext },
    { key: 'lyrics', label: y.lyrics },
    ...(t.provider === 'youtube' ? [{ key: 'related' as const, label: y.related }] : []),
  ];
  const shown = tabs.some((x) => x.key === tab) ? tab : 'next';

  return (
    <div className="yt-np" role="dialog" aria-label={y.nowPlaying}>
      <IconButton
        ref={close}
        className="yt-np-close"
        label={y.closePlayer}
        icon="chevronDown"
        onClick={onClose}
      />
      <div className="yt-np-art">
        <Thumb src={t.artwork[0]?.url ?? ''} />
      </div>
      <div className="yt-np-side">
        <div className="yt-np-tabs" role="tablist" aria-label={y.nowPlaying}>
          {tabs.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              id={`${id}-${x.key}`}
              aria-selected={x.key === shown}
              aria-controls={`${id}-panel`}
              onClick={() => setTab(x.key)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div
          className="yt-np-panel"
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-${shown}`}
        >
          {shown === 'next' && <UpNext />}
          {shown === 'lyrics' && <LyricsPanel track={t} />}
          {shown === 'related' && <Related id={t.id} />}
        </div>
      </div>
    </div>
  );
}

function UpNext() {
  const c = usePlayback();
  // The queue itself is the stable snapshot; a fresh array from the selector would loop.
  const next = upcoming(useQueue((q) => q)).slice(0, 50);
  if (!next.length) return <p className="yt-empty">{y.nothingNext}</p>;
  return (
    <ul className="yt-rows yt-rows--list">
      {next.map((t, i) => (
        <Row
          // biome-ignore lint/suspicious/noArrayIndexKey: the queue may hold the same song twice
          key={`${t.key}:${i}`}
          item={itemOfTrack(t)}
          index={i}
          onPlay={() => c.jump(i)}
        />
      ))}
    </ul>
  );
}

/**
 * ECHO's own lyrics (the owner, 2026-11-03: "the same" as in Navidrome mode): the Stage's lyric
 * field, on its room, with its attribution and source menu. Only when ECHO's sources have none
 * do YouTube's plain lyrics stand in.
 */
function LyricsPanel({ track }: { track: Track }) {
  const missing = useStore(lyricsStore, (l) => l.trackKey === track.key && l.state === 'missing');
  if (missing && track.provider === 'youtube') return <YouTubeLyrics track={track} />;
  return (
    <div className="yt-np-stage">
      <Stage>
        <div className="ly-area">
          <LyricsView />
        </div>
      </Stage>
    </div>
  );
}

function YouTubeLyrics({ track }: { track: Track }) {
  const [plain, setPlain] = useState<{ key: string; lyrics: YtLyrics | null } | null>(null);
  useEffect(() => {
    let live = true;
    ytLyrics(track.id).then(
      (lyrics) => live && setPlain({ key: track.key, lyrics }),
      () => live && setPlain({ key: track.key, lyrics: null }),
    );
    return () => {
      live = false;
    };
  }, [track]);
  const mine = plain?.key === track.key ? plain : null;
  if (!mine)
    return (
      <div className="yt-loading" aria-busy="true">
        <span className="visually-hidden">{y.loading}</span>
      </div>
    );
  if (!mine.lyrics) return <p className="yt-empty">{y.noLyrics}</p>;
  return (
    <>
      <p className="yt-lyrics-plain">{mine.lyrics.text}</p>
      <p className="yt-strap">{y.lyricsSource(mine.lyrics.source)}</p>
    </>
  );
}

function Related({ id }: { id: string }) {
  const state = useYtPage(`related/${encodeURIComponent(id)}`);
  return <PageState state={state}>{(p) => <Shelves shelves={p.shelves} />}</PageState>;
}
