import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { YT_TABS, type YtItem, type YtPage, type YtTab } from '../../shared/youtube.ts';
import { usePlayback, usePlayer } from '../playback/context.tsx';
import { sessionStore } from '../session.ts';
import { Link } from '../shell/link.tsx';
import { strings } from '../strings.ts';
import { Icon } from '../ui/icons.tsx';
import { useCoverChange } from '../ui/motion.ts';
import type { YtRoute } from '../view.ts';
import { itemOfTrack, LikeWord, PageState, Row, Shelves, Thumb, useYtPage } from './parts.tsx';
import { playItem } from './play.ts';
import { hintSong } from './radio.ts';

// YouTube Music mode's pages (spec goals 2–6): Home, Explore, Library, search, and the pages of an
// album, an artist and a playlist. Every one is a YtPage from the server.

const y = strings.youtube;

export function YtPageView({ page }: { page: YtRoute }) {
  switch (page.kind) {
    case 'home':
      return <TodayPage />;
    case 'explore':
    case 'library':
      return <ShelvesPage path={page.kind} title={y[page.kind]} />;
    case 'search':
      return page.q ? <SearchPage q={page.q} tab={page.tab} /> : <TodayPage />;
    case 'album':
    case 'playlist':
    case 'artist':
      return <DetailPage kind={page.kind} id={page.id} />;
  }
}

function ShelvesPage({ path, title }: { path: string; title: string }) {
  const state = useYtPage(path);
  return (
    <>
      <h1 className="visually-hidden" tabIndex={-1}>
        {title}
      </h1>
      <PageState state={state}>{(p) => <Shelves shelves={p.shelves} />}</PageState>
    </>
  );
}

/**
 * Today (board C): Now spinning beside Quick picks, then the other shelves. The first shelf of
 * songs sits beside Now spinning; without one, the shelves follow it.
 */
function TodayPage() {
  const state = useYtPage('home');
  return (
    <>
      <h1 className="visually-hidden" tabIndex={-1}>
        {y.home}
      </h1>
      <PageState state={state}>
        {(p) => {
          const picks = p.shelves.find((x) => x.layout === 'rows');
          const rest = p.shelves.filter((x) => x !== picks);
          return (
            <>
              <div className="yt-today">
                <NowSpinning fallback={picks?.items[0]} />
                {picks && <Shelves shelves={[picks]} />}
              </div>
              <Shelves shelves={rest} />
            </>
          );
        }}
      </PageState>
    </>
  );
}

/** The song playing, else the first Quick pick: its cover, title, credit, radio and like. */
function NowSpinning({ fallback }: { fallback?: YtItem }) {
  const c = usePlayback();
  const playing = usePlayer((p) => p.track);
  const session = useStore(sessionStore);
  const t = playing?.provider === 'youtube' ? playing : fallback?.track;
  const spinning = useRef<HTMLElement>(null);
  useCoverChange(spinning, t?.key, '.yt-thumb');
  if (!t) return null;
  const item = playing?.provider === 'youtube' ? itemOfTrack(playing) : (fallback as YtItem);
  const by = t.artists.map((a) => a.name).join(', ');
  const signedIn = session.status === 'signedIn' && !!session.youtube?.signedIn;
  return (
    <section className="yt-spinning" aria-label={y.nowSpinning} ref={spinning}>
      <span className="yt-kicker">{y.nowSpinning}</span>
      <Thumb src={t.artwork[0]?.url ?? ''} />
      <h2 className="yt-spinning-title">{t.title}</h2>
      <p className="yt-hero-sub">{t.album.title ? y.credit(by, t.album.title) : by}</p>
      <div className="yt-actions">
        <button
          type="button"
          className="yt-button yt-button--light"
          onClick={() => void playItem(c, { ...item, track: t })}
        >
          {y.startRadio}
        </button>
        {signedIn && <LikeWord id={t.id} />}
      </div>
    </section>
  );
}

function SearchPage({ q, tab }: { q: string; tab: YtTab }) {
  const state = useYtPage(`search?${new URLSearchParams({ q, tab })}`);
  return (
    <>
      <h1 className="visually-hidden" tabIndex={-1}>
        {q}
      </h1>
      <nav className="yt-tabs-row" aria-label={y.resultsLabel}>
        {YT_TABS.map((t) => (
          <Link
            key={t}
            className="yt-chip"
            to={{ view: 'yt', page: { kind: 'search', q, tab: t } }}
            aria-current={t === tab ? 'page' : undefined}
          >
            {y.tabs[t]}
          </Link>
        ))}
      </nav>
      <PageState state={state}>
        {(p) =>
          p.shelves.length ? (
            <Shelves shelves={p.shelves} />
          ) : (
            <p className="yt-empty">{y.noResults(q)}</p>
          )
        }
      </PageState>
    </>
  );
}

function DetailPage({ kind, id }: { kind: 'album' | 'playlist' | 'artist'; id: string }) {
  const state = useYtPage(`${kind}/${encodeURIComponent(id)}`);
  return <PageState state={state}>{(p) => <Detail page={p} kind={kind} id={id} />}</PageState>;
}

function Detail({
  page,
  kind,
  id,
}: {
  page: YtPage;
  kind: 'album' | 'playlist' | 'artist';
  id: string;
}) {
  const c = usePlayback();
  const tracks = page.tracks ?? [];
  // Play plays the first song, and the first rows are the likeliest presses: looked up while the
  // page is read.
  const songs = tracks.map((t) => t.id).join(' ');
  useEffect(() => hintSong.page(songs ? songs.split(' ') : []), [songs]);
  const context = { kind, id, title: page.title } as const;
  return (
    <>
      <header className="yt-hero" data-kind={kind}>
        {page.thumb && <Thumb src={page.thumb} round={kind === 'artist'} />}
        <div className="yt-hero-text">
          <h1 tabIndex={-1}>{page.title}</h1>
          {page.subtitle && <p className="yt-hero-sub">{page.subtitle}</p>}
          {page.description && <p className="yt-hero-desc">{page.description}</p>}
          {tracks.length > 0 && (
            <div className="yt-actions">
              <button
                type="button"
                className="yt-button yt-button--light"
                onClick={() => c.playList(tracks, 0, context)}
              >
                <Icon name="play" solid />
                {y.play}
              </button>
              <button
                type="button"
                className="yt-button"
                onClick={() => c.playList(tracks, 'shuffle', context)}
              >
                <Icon name="shuffle" />
                {y.shuffle}
              </button>
            </div>
          )}
        </div>
      </header>
      {kind !== 'artist' && tracks.length > 0 && (
        <ol className="yt-rows yt-rows--list" aria-label={page.title}>
          {tracks.map((t, i) => (
            <Row
              // biome-ignore lint/suspicious/noArrayIndexKey: a playlist may hold the same song twice
              key={`${t.key}:${i}`}
              item={itemOfTrack(t)}
              index={i}
              onPlay={() => void playItem(c, itemOfTrack(t), { tracks, ...context })}
            />
          ))}
        </ol>
      )}
      <Shelves shelves={page.shelves} />
    </>
  );
}
