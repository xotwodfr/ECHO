import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Track } from '../../shared/types.ts';
import type { ArtistInfo } from '../library.ts';
import { useLibrary, usePlayback, usePlayer, useQueue } from '../playback/context.tsx';
import { upcoming } from '../playback/queue.ts';
import { strings } from '../strings.ts';
import { IconButton } from '../ui/controls.tsx';
import { Artwork } from '../ui/media.tsx';
import { useCoverChange, useExit } from '../ui/motion.ts';
import { dropTracks } from './drag.ts';
import { HeartButton } from './hearts.tsx';
import { Link } from './link.tsx';
import { panels } from './panels.ts';
import { QueueList } from './Queue.tsx';

// The right panel (DESIGN_SYSTEM.md §5): Spotify's Now Playing view (the cover, the song, about
// the artist, what is next) or the queue, opened and closed from the player.

export function RightPanel() {
  const right = useStore(panels, (s) => s.right);
  // Closing, it keeps showing its last pane while it slides out (DESIGN_SYSTEM.md §11).
  const ref = useRef<HTMLElement>(null);
  const last = useRef(right);
  if (right) last.current = right;
  const shown = useExit(!!right, ref);
  const pane = right ?? last.current;
  if (!shown || !pane) return null;
  const title = pane === 'queue' ? strings.queue.title : strings.panel.nowPlaying;
  return (
    <aside ref={ref} className="right-panel" aria-label={title}>
      <div className="rp-pane" key={pane}>
        {pane === 'queue' ? <QueuePane /> : <NowPlayingPane />}
      </div>
    </aside>
  );
}

function PaneHead({ title }: { title: string }) {
  return (
    <header className="rp-head">
      <h2>{title}</h2>
      <IconButton
        label={`${strings.panel.hide} ${title}`}
        icon="close"
        onClick={() => panels.setState({ right: null })}
      />
    </header>
  );
}

function QueuePane() {
  const c = usePlayback();
  return (
    <>
      <PaneHead title={strings.queue.title} />
      {/* A song dropped on the queue joins its end (drag.ts). */}
      <div className="rp-body" {...dropTracks((t) => c.addToQueue(t, t[0]?.title ?? ''))}>
        <QueueList scope=".right-panel" />
      </div>
    </>
  );
}

// A YouTube song playing in Navidrome mode (spec call 17): no Navidrome links, no heart.
const artistLinks = (t: Track) =>
  t.artists.map((a, i) => (
    <span key={a.id ?? a.name}>
      {i > 0 && ', '}
      {a.id && t.provider === 'navidrome' ? (
        <Link to={{ view: 'artist', id: a.id }}>{a.name}</Link>
      ) : (
        a.name
      )}
    </span>
  ));

function NowPlayingPane() {
  const t = usePlayer((p) => p.track);
  const body = useRef<HTMLDivElement>(null);
  useCoverChange(body, t?.key);
  const source = useQueue((q) => q.contextSource);
  const next = useQueue((q) => upcoming(q)[0]);
  if (!t)
    return (
      <>
        <PaneHead title={strings.panel.nowPlaying} />
        <div className="rp-body rp-empty">
          <p className="rp-empty-title">{strings.panel.nothing}</p>
          <p className="empty">{strings.panel.nothingHint}</p>
        </div>
      </>
    );
  return (
    <>
      <PaneHead title={source?.title ?? t.album.title} />
      <div className="rp-body" ref={body}>
        <Artwork key={t.key} size="np" src={t.artwork[0]?.url} title={t.album.title} />
        <div className="rp-song">
          <div className="rp-song-text">
            <p className="rp-title">
              {t.album.id && t.provider === 'navidrome' ? (
                <Link to={{ view: 'album', id: t.album.id }}>{t.title}</Link>
              ) : (
                t.title
              )}
            </p>
            <p className="rp-artist">{artistLinks(t)}</p>
          </div>
          {t.provider === 'navidrome' && <HeartButton track={t} />}
        </div>
        <AboutArtist track={t} />
        {next && (
          <section className="rp-card" aria-labelledby="rp-next">
            <header className="rp-card-head">
              <h3 id="rp-next">{strings.panel.nextInQueue}</h3>
              <button
                type="button"
                className="text-btn"
                onClick={() => panels.setState({ right: 'queue' })}
              >
                {strings.panel.openQueue}
              </button>
            </header>
            <div className="rp-next">
              <Artwork size="row" src={next.artwork[0]?.url} title={next.album.title} />
              <span>
                <span className="rp-next-title">{next.title}</span>
                <span className="rp-next-sub">{next.artists.map((a) => a.name).join(', ')}</span>
              </span>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/** The artist's picture and bio, when Navidrome knows them (Last.fm): in either mode. */
function AboutArtist({ track: t }: { track: Track }) {
  const library = useLibrary();
  const id = t.provider === 'navidrome' ? t.artists[0]?.id : undefined;
  const [info, setInfo] = useState<ArtistInfo | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!id || !library?.artistInfo) return;
    let current = true;
    library.artistInfo(id).then(
      (x) => current && setInfo(x),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [library, id]);
  if (!id || !info?.bio) return null;
  const name = t.artists[0]?.name ?? '';
  return (
    <section className="rp-card rp-about" aria-labelledby="rp-about">
      <h3 id="rp-about" className="rp-about-label">
        {strings.panel.aboutArtist}
      </h3>
      {info.image && (
        <span className="rp-about-img">
          <img src={info.image} alt="" loading="lazy" />
        </span>
      )}
      <div className="rp-about-body">
        <p className="rp-about-name">
          <Link to={{ view: 'artist', id }}>{name}</Link>
        </p>
        <p className="rp-about-bio">{info.bio}</p>
      </div>
    </section>
  );
}
