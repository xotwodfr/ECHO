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

// YouTube Music mode's player bar (mockup A, spec goal 7): a thin red progress line on top, the
// transport and time on the left, the song and its like in the middle, volume, repeat, shuffle and
// the full-screen player on the right. On phones a mini player: the song, play/pause, the line.

const y = strings.youtube;

function LikeButton({ id }: { id: string }) {
  const [on, toggle] = useLike(id);
  return <IconButton label={y.like} icon="heart" pressed={on} onClick={() => void toggle()} />;
}

export function PlayerBar({ onOpen, compact }: { onOpen: () => void; compact: boolean }) {
  const c = usePlayback();
  const s = usePlayer((p) => p);
  const session = useStore(sessionStore);
  useTicker(s.status === 'playing');
  const t = s.track;
  if (!t) return null;
  const pos = positionNow(s, performance.now());
  const active = s.status === 'playing' || s.status === 'loading' || s.status === 'buffering';
  const signedIn = session.status === 'signedIn' && !!session.youtube?.signedIn;
  const by = [t.artists.map((a) => a.name).join(', '), t.album.title].filter(Boolean).join(' • ');

  return (
    <section className="yt-player" aria-label={strings.dock.label} data-status={s.status}>
      <div className="yt-progress">
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
      </div>
      <div className="yt-player-row">
        <div className="yt-transport">
          {!compact && (
            <IconButton label={strings.ui.previous} icon="previous" onClick={() => c.previous()} />
          )}
          <IconButton
            className="yt-play"
            label={active ? strings.ui.pause : strings.ui.play}
            icon={active ? 'pause' : 'play'}
            size="lg"
            onClick={() => c.toggle()}
          />
          {!compact && <IconButton label={strings.ui.next} icon="next" onClick={() => c.next()} />}
          {!compact && (
            <span className="yt-time num">{`${formatTime(pos)} / ${formatTime(t.durationMs)}`}</span>
          )}
        </div>
        <button type="button" className="yt-player-song" onClick={onOpen}>
          <Thumb src={t.artwork[0]?.url ?? ''} />
          <span className="yt-row-text">
            <span className="yt-strip-title">{t.title}</span>
            <span className="yt-strip-sub">{by}</span>
          </span>
        </button>
        {t.provider === 'youtube' && signedIn && <LikeButton id={t.id} />}
        <div className="yt-player-end">
          {!compact && <Volume value={s.volume} onChange={c.setVolume} />}
          {!compact && (
            <IconButton
              label={strings.dock.repeat[s.repeat]}
              icon={s.repeat === 'one' ? 'repeatOne' : 'repeat'}
              pressed={s.repeat !== 'off'}
              onClick={() => c.cycleRepeat()}
            />
          )}
          {!compact && (
            <IconButton
              label={strings.ui.shuffle}
              icon="shuffle"
              pressed={s.shuffle}
              onClick={() => c.toggleShuffle()}
            />
          )}
          <IconButton
            className="yt-open"
            label={y.openPlayer}
            icon="chevronDown"
            onClick={onOpen}
          />
        </div>
      </div>
    </section>
  );
}
