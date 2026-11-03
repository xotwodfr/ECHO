import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Track } from '../../shared/types.ts';
import type { YtLyrics } from '../../shared/youtube.ts';
import { usePlayback, usePlayer, useQueue } from '../playback/context.tsx';
import { upcoming } from '../playback/queue.ts';
import { sessionStore } from '../session.ts';
import { Stage } from '../shell/Stage.tsx';
import { LyricsView } from '../shell/StageViews.tsx';
import { lyricsStore } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { IconButton } from '../ui/controls.tsx';
import { Volume } from '../ui/slider.tsx';
import { ytLyrics } from './api.ts';
import { ModeWords, Progress } from './PlayerBar.tsx';
import { itemOfTrack, LikeWord, PageState, Row, Shelves, Thumb, useYtPage } from './parts.tsx';

// YouTube Music mode's full-screen player, "Liner notes" (board F): paper. Across the top the close
// chevron and where the music plays from; left the cover, the title, the credit, the hairline, the
// controls; right Up next, Lyrics (ECHO's own, on paper) and Related. It covers the page, not the
// strip. Esc or the chevron closes it.

const y = strings.youtube;
export type Tab = 'next' | 'lyrics' | 'related';

export function NowPlaying({
  onClose,
  tab,
  onTab,
}: {
  onClose: () => void;
  tab: Tab;
  onTab: (tab: Tab) => void;
}) {
  const c = usePlayback();
  const t = usePlayer((p) => p.track);
  const status = usePlayer((p) => p.status);
  const volume = usePlayer((p) => p.volume);
  const source = useQueue((q) => q.contextSource);
  const session = useStore(sessionStore);
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
  const active = status === 'playing' || status === 'loading' || status === 'buffering';
  const by = t.artists.map((a) => a.name).join(', ');
  const signedIn = session.status === 'signedIn' && !!session.youtube?.signedIn;

  return (
    <div className="yt-np" role="dialog" aria-label={y.nowPlaying}>
      <div className="yt-np-head">
        <IconButton
          ref={close}
          className="yt-np-close"
          label={y.closePlayer}
          icon="chevronDown"
          onClick={onClose}
        />
        {source && <span className="yt-kicker">{y.playingFrom(source.title)}</span>}
      </div>
      <section className="yt-np-art" aria-label={t.title}>
        <Thumb src={t.artwork[0]?.url ?? ''} />
        <h2 className="yt-np-title">{t.title}</h2>
        <p className="yt-hero-sub">{t.album.title ? y.credit(by, t.album.title) : by}</p>
        <Progress className="yt-np-progress" />
        <div className="yt-np-controls">
          <IconButton label={strings.ui.previous} icon="previous" onClick={() => c.previous()} />
          <IconButton
            className="yt-np-play"
            label={active ? strings.ui.pause : strings.ui.play}
            icon={active ? 'pause' : 'play'}
            size="lg"
            onClick={() => c.toggle()}
          />
          <IconButton label={strings.ui.next} icon="next" onClick={() => c.next()} />
          {t.provider === 'youtube' && signedIn && <LikeWord id={t.id} />}
        </div>
        <div className="yt-np-more">
          <ModeWords />
          <Volume value={volume} onChange={c.setVolume} />
        </div>
      </section>
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
              onClick={() => onTab(x.key)}
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
    <div className="yt-np-stage ln-lyrics">
      <Stage room={false}>
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
