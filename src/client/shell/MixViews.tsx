import { useMemo } from 'react';
import type { Mix, PlayContext } from '../../shared/types.ts';
import { usePlayback } from '../playback/context.tsx';
import { strings } from '../strings.ts';
import { buttonClass, IconButton } from '../ui/controls.tsx';
import { Icon } from '../ui/icons.tsx';
import { Artwork, TrackList } from '../ui/media.tsx';
import { BlockError, RowsLoading } from '../ui/states.tsx';
import { PageBody, PageHead, PlayXL, Rows, useContextPlaying } from './LibraryViews.tsx';
import { Link } from './link.tsx';
import { trackOf, useMixes, useWrapped } from './mixes.ts';

// Made For You's pages (project 2 of the Spotify redesign): a mix, as a playlist made from the
// user's plays, and Wrapped, their year in music.

/** Each kind of mix keeps its colour, as Spotify's; the Daily Mixes take one each. */
const HUES: Record<string, number> = { discover: 7, 'on-repeat': 0, rewind: 1, daylist: 11 };
export const hueOf = (id: string) => HUES[id] ?? (Number(id.replace(/\D/g, '')) * 2 + 2) % 12;

/** A mix's cover: its first song's cover in the mix's colour, the mix's name over it. */
export function MixArt({ mix, size }: { mix: Mix; size: 'grid' | 'detail' }) {
  const cover = mix.tracks.find((t) => t.cover)?.cover;
  return (
    <span className={`art art--${size} mix-art`} data-hue={hueOf(mix.id)} aria-hidden="true">
      {cover && <img src={cover} alt="" loading="lazy" decoding="async" />}
      <span className="mix-art-title">{mix.title}</span>
    </span>
  );
}

export function WrappedArt({ year }: { year: number }) {
  return (
    <span className="art art--grid mix-art mix-art--wrapped" data-hue={8} aria-hidden="true">
      <span className="mix-art-title">
        {strings.wrapped.title} {year}
      </span>
    </span>
  );
}

export function MixView({ id }: { id: string }) {
  const c = usePlayback();
  const mixes = useMixes();
  const mix = Array.isArray(mixes) ? mixes.find((m) => m.id === id) : undefined;
  const tracks = useMemo(() => mix?.tracks.map(trackOf) ?? [], [mix]);
  const { live, playing } = useContextPlaying((x) => x?.kind === 'mix' && x.id === id);
  if (mixes === null) return <RowsLoading label={strings.mix.madeForYou} media />;
  if (mixes === 'error')
    return <BlockError what={strings.mix.failed} onRetry={() => location.reload()} />;
  if (!mix)
    return (
      <div className="page-empty">
        <Icon name="music" />
        <h1 tabIndex={-1}>{strings.mix.gone}</h1>
        <p className="empty">{strings.mix.goneHint}</p>
        <Link className={buttonClass('secondary')} to={{ view: 'home' }}>
          {strings.mix.toHome}
        </Link>
      </div>
    );
  const ctx: PlayContext = { kind: 'mix', id, title: mix.title };
  return (
    <>
      <PageHead
        kind={strings.playlist.title}
        title={mix.title}
        art={<MixArt mix={mix} size="detail" />}
        play={{ live, playing, onPlay: () => c.playList(tracks, 0, ctx) }}
        facts={`${mix.subtitle} • ${strings.album.songs(tracks.length)}`}
      />
      <PageBody>
        <div className="action-bar">
          <PlayXL
            label={mix.title}
            live={live}
            playing={playing}
            onPlay={() => c.playList(tracks, 0, ctx)}
          />
          <IconButton
            size="lg"
            label={strings.album.shuffleName(mix.title)}
            icon="shuffle"
            onClick={() => c.playList(tracks, 'shuffle', ctx)}
          />
        </div>
        <TrackList label={mix.title} ruled>
          <Rows tracks={tracks} context={ctx} numbered art />
        </TrackList>
      </PageBody>
    </>
  );
}

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

export function WrappedView({ year: asked }: { year?: number }) {
  const c = usePlayback();
  const year = asked ?? new Date().getFullYear();
  const w = useWrapped(year);
  const s = strings.wrapped;
  const tracks = useMemo(() => (w && w !== 'error' ? w.tracks.map(trackOf) : []), [w]);
  const ctx: PlayContext = { kind: 'mix', id: `wrapped-${year}`, title: s.playTop(year) };
  const { live, playing } = useContextPlaying((x) => x?.kind === 'mix' && x.id === ctx.id);
  const previous = (
    <Link className={buttonClass('secondary')} to={{ view: 'wrapped', year: year - 1 }}>
      {s.previous(year - 1)}
    </Link>
  );
  if (w === null) return <RowsLoading label={s.heading(year)} media />;
  if (w === 'error') return <BlockError what={s.failed} onRetry={() => location.reload()} />;
  if (!w.plays)
    return (
      <div className="page-empty">
        <Icon name="music" />
        <h1 tabIndex={-1}>{s.empty(year)}</h1>
        <p className="empty">{s.emptyHint}</p>
        {previous}
      </div>
    );
  return (
    <div className="wrapped">
      <header className="wrapped-hero" data-hue={8}>
        <p className="ph-kind">{s.title}</p>
        <h1 tabIndex={-1}>{s.heading(year)}</h1>
        <p className="wrapped-figure">
          <strong>{w.minutes.toLocaleString()}</strong>
          <span>{s.minutes}</span>
        </p>
        <div className="action-bar">
          <PlayXL
            label={s.playTop(year)}
            live={live}
            playing={playing}
            onPlay={() => c.playList(tracks, 0, ctx)}
          />
          <span className="wrapped-play-label">{s.playTop(year)}</span>
        </div>
      </header>
      <div className="wrapped-cards">
        <section className="wrapped-card" data-hue={0} aria-labelledby="wr-artists">
          <h2 id="wr-artists">{s.topArtists}</h2>
          <ol>
            {w.artists.map((a, i) => (
              <li key={a.id ?? a.name}>
                <span className="wrapped-rank">{i + 1}</span>
                <span className="wrapped-song">
                  {a.id ? <Link to={{ view: 'artist', id: a.id }}>{a.name}</Link> : a.name}
                  <span className="wrapped-count">{s.plays(a.plays)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="wrapped-card" data-hue={7} aria-labelledby="wr-songs">
          <h2 id="wr-songs">{s.topSongs}</h2>
          <ol>
            {w.tracks.slice(0, 5).map((t, i) => (
              <li key={t.id}>
                <span className="wrapped-rank">{i + 1}</span>
                <Artwork size="list" src={t.cover} title={t.album} />
                <span className="wrapped-song">
                  <span>{t.title}</span>
                  <span className="wrapped-count">{t.artist}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="wrapped-card" data-hue={4} aria-labelledby="wr-albums">
          <h2 id="wr-albums">{s.topAlbums}</h2>
          <ol>
            {w.albums.map((a, i) => (
              <li key={a.id ?? a.title}>
                <span className="wrapped-rank">{i + 1}</span>
                <Artwork size="list" src={a.cover} title={a.title} />
                <span className="wrapped-song">
                  {a.id ? <Link to={{ view: 'album', id: a.id }}>{a.title}</Link> : a.title}
                  <span className="wrapped-count">{a.artist}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="wrapped-card" data-hue={5} aria-labelledby="wr-day">
          <h2 id="wr-day">{s.topDay}</h2>
          {w.topDay && (
            <p className="wrapped-figure">
              <strong>{DAY_FORMAT.format(new Date(w.topDay.date))}</strong>
              <span>{s.plays(w.topDay.plays)}</span>
            </p>
          )}
          <p className="wrapped-figure">
            <strong>{w.distinctArtists.toLocaleString()}</strong>
            <span>{s.artists}</span>
          </p>
        </section>
      </div>
      <p className="wrapped-more">{previous}</p>
    </div>
  );
}
