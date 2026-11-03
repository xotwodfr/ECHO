import { useStore } from 'zustand';
import { usePlayback, usePlayer, useTicker } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { sessionStore } from '../session.ts';
import { strings } from '../strings.ts';
import { IconButton } from '../ui/controls.tsx';
import { formatTime } from '../ui/logic.ts';
import { Slider, Volume } from '../ui/slider.tsx';
import { useLike } from './likes.ts';
import { Thumb } from './parts.tsx';

// YouTube Music mode's player strip, "Liner notes" (board C): the ink strip along the bottom. Play,
// the title in small capitals, a hairline progress line with its times, then the words Previous,
// Next, Up next and Lyrics (which open the full-screen player on that tab), Shuffle and Repeat,
// the volume, the cover and the like. On phones: the cover, the title, play/pause, the line along
// the top.

const y = strings.youtube;

export function LikeButton({ id }: { id: string }) {
  const [on, toggle] = useLike(id);
  return <IconButton label={y.like} icon="heart" pressed={on} onClick={() => void toggle()} />;
}

/** The song's hairline with its times (the strip and the full-screen player). */
export function Progress({ className }: { className: string }) {
  const c = usePlayback();
  const s = usePlayer((p) => p);
  useTicker(s.status === 'playing');
  const t = s.track;
  if (!t) return null;
  const pos = positionNow(s, performance.now());
  return (
    <div className={className}>
      <span className="yt-time num">{formatTime(pos)}</span>
      <Slider
        variant="scrubber"
        label={strings.ui.seek}
        value={pos}
        max={t.durationMs}
        step={5000}
        bigStep={15_000}
        valueText={(v) => `${formatTime(v)} / ${formatTime(t.durationMs)}`}
        onChange={c.seek}
        disabled={!s.capabilities.canSeek}
      />
      <span className="yt-time num">{formatTime(t.durationMs)}</span>
    </div>
  );
}

const repeatName = (r: 'off' | 'all' | 'one') =>
  r === 'off' ? y.repeat : r === 'all' ? y.repeatAll : y.repeatOne;

/** Shuffle and Repeat as words, underlined when on. */
export function ModeWords() {
  const c = usePlayback();
  const shuffle = usePlayer((p) => p.shuffle);
  const repeat = usePlayer((p) => p.repeat);
  return (
    <>
      <button
        type="button"
        className="yt-word"
        aria-pressed={shuffle}
        onClick={() => c.toggleShuffle()}
      >
        {y.shuffle}
      </button>
      <button
        type="button"
        className="yt-word"
        aria-pressed={repeat !== 'off'}
        onClick={() => c.cycleRepeat()}
      >
        {repeatName(repeat)}
      </button>
    </>
  );
}

export function PlayerBar({
  onOpen,
  compact,
}: {
  onOpen: (tab: 'next' | 'lyrics') => void;
  compact: boolean;
}) {
  const c = usePlayback();
  const t = usePlayer((p) => p.track);
  const status = usePlayer((p) => p.status);
  const volume = usePlayer((p) => p.volume);
  const session = useStore(sessionStore);
  if (!t) return null;
  const active = status === 'playing' || status === 'loading' || status === 'buffering';
  const signedIn = session.status === 'signedIn' && !!session.youtube?.signedIn;
  const by = t.artists.map((a) => a.name).join(', ');

  return (
    <section className="yt-player" aria-label={strings.dock.label} data-status={status}>
      {compact && <Progress className="yt-progress" />}
      <div className="yt-player-row">
        <IconButton
          className="yt-play"
          label={active ? strings.ui.pause : strings.ui.play}
          icon={active ? 'pause' : 'play'}
          onClick={() => c.toggle()}
        />
        <button type="button" className="yt-player-song" onClick={() => onOpen('next')}>
          <Thumb src={t.artwork[0]?.url ?? ''} />
          <span className="yt-strip-text">
            <span className="yt-strip-title">{t.title}</span>
            <span className="yt-strip-sub">
              <span className="yt-strip-dash" aria-hidden="true">
                —{' '}
              </span>
              {by}
            </span>
          </span>
        </button>
        {!compact && <Progress className="yt-strip-progress" />}
        {!compact && (
          <div className="yt-strip-words">
            <button type="button" className="yt-word" onClick={() => c.previous()}>
              {strings.ui.previous}
            </button>
            <button type="button" className="yt-word" onClick={() => c.next()}>
              {strings.ui.next}
            </button>
            <button type="button" className="yt-word" onClick={() => onOpen('next')}>
              {y.upNext}
            </button>
            <button type="button" className="yt-word" onClick={() => onOpen('lyrics')}>
              {y.lyrics}
            </button>
            <ModeWords />
          </div>
        )}
        {!compact && <Volume value={volume} onChange={c.setVolume} />}
        {t.provider === 'youtube' && signedIn && <LikeButton id={t.id} />}
      </div>
    </section>
  );
}
