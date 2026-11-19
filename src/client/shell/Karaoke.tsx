import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { songTrack } from '../library-navidrome.ts';
import { usePlayback } from '../playback/context.tsx';
import {
  type KaraokeState,
  karaokeStore,
  markReady,
  readyKaraokeSongs,
  setKaraoke,
  setVocalLevel,
} from '../playback/karaoke.ts';
import { prefsStore } from '../prefs.ts';
import { strings } from '../strings.ts';
import { IconButton } from '../ui/controls.tsx';
import { AlbumTile } from '../ui/media.tsx';
import { Slider } from '../ui/slider.tsx';

// Karaoke mode on the web (docs/KARAOKE.md): the player bar's karaoke mic and Vocals slider, the
// same slider in Now Playing and the lyrics view, Home's shelf of songs ready to sing.

/** What to tell the listener about the song playing; null when there's nothing to say. */
export function karaokeNote(s: KaraokeState): string | null {
  const k = strings.karaoke;
  switch (s.status) {
    case 'preparing':
      return k.preparing(s.ahead);
    case 'failed':
      return k.failed;
    case 'tooLong':
      return k.tooLong;
    case 'unavailable':
      return s.server === false ? k.noServer : k.unavailable;
    case 'downmixed':
      return k.downmixed;
    default:
      return null;
  }
}

/** The Vocals slider: 0% the instrumental, 100% the song as recorded. */
export function VocalsSlider({ note = false }: { note?: boolean }) {
  const level = useStore(prefsStore, (p) => p.playback.vocalLevel);
  const state = useStore(karaokeStore);
  const text = note ? karaokeNote(state) : null;
  return (
    <div className="karaoke-vocals">
      <div className="karaoke-vocals-row">
        <span className="karaoke-vocals-label">{strings.karaoke.vocals}</span>
        <Slider
          variant="volume"
          label={strings.karaoke.vocals}
          value={level}
          max={1}
          step={0.05}
          bigStep={0.2}
          wheel
          valueText={(v) => strings.karaoke.vocalsValue(Math.round(v * 100))}
          onInput={setVocalLevel}
          onChange={setVocalLevel}
        />
        <span className="karaoke-vocals-value">
          {strings.karaoke.vocalsValue(Math.round(level * 100))}
        </span>
      </div>
      {text && (
        <p className="karaoke-note" role="status">
          {text}
        </p>
      )}
    </div>
  );
}

/** The player bar's karaoke mic: Karaoke on or off; while on, the Vocals slider beside it. */
export function KaraokeControl() {
  const on = useStore(prefsStore, (p) => p.playback.karaoke);
  return (
    <span className="dock-karaoke" data-on={on || undefined}>
      <IconButton
        label={on ? strings.karaoke.on : strings.karaoke.off}
        icon="karaoke"
        pressed={on}
        onClick={() => setKaraoke(!on)}
      />
      {on && <VocalsSlider />}
    </span>
  );
}

/** Now Playing and the lyrics view: the toggle, and while on the slider with what's happening. */
export function KaraokePanel() {
  const on = useStore(prefsStore, (p) => p.playback.karaoke);
  return (
    <div className="karaoke-panel" data-on={on || undefined}>
      <IconButton
        label={on ? strings.karaoke.on : strings.karaoke.off}
        icon="karaoke"
        pressed={on}
        onClick={() => setKaraoke(!on)}
      />
      {on ? (
        <VocalsSlider note />
      ) : (
        <span className="karaoke-panel-title">{strings.karaoke.title}</span>
      )}
    </div>
  );
}

/** Home's shelf: songs whose karaoke version is ready, newest first; playing one turns Karaoke on. */
export function KaraokeShelf() {
  const c = usePlayback();
  const [songs, setSongs] = useState<ReturnType<typeof songTrack>[] | null>(null);
  useEffect(() => {
    let live = true;
    readyKaraokeSongs()
      .then((s) => live && setSongs(s.map(songTrack)))
      .catch(() => live && setSongs([]));
    return () => {
      live = false;
    };
  }, []);
  if (!songs?.length) return null;
  const play = (i: number) => {
    // All ready: they play as karaoke from the first note, not after a switch.
    markReady(songs);
    setKaraoke(true);
    c.playList(songs, i, { kind: 'karaoke', title: strings.karaoke.shelf });
  };
  return (
    <section className="shelf" aria-labelledby="shelf-karaoke">
      <h2 id="shelf-karaoke">{strings.karaoke.shelf}</h2>
      <ul className="album-grid card-row" aria-label={strings.karaoke.shelf}>
        {songs.map((t, i) => (
          <AlbumTile
            key={t.key}
            id={t.album.id ?? t.id}
            title={t.title}
            artist={t.artists.map((a) => a.name).join(', ')}
            cover={t.artwork[0]?.url}
            onPlay={() => play(i)}
          />
        ))}
      </ul>
    </section>
  );
}
