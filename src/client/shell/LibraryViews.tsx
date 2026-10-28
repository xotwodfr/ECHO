import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { PlayContext, Track } from '../../shared/types.ts';
import { ALBUM_SORTS, type Album, albumDurationMs, type Playlist } from '../library.ts';
import { useLibrary, usePlayback, usePlayer, useQueue } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { strings } from '../strings.ts';
import { Button, buttonClass, ProviderMark } from '../ui/controls.tsx';
import { formatTime, toastStore } from '../ui/logic.ts';
import {
  AlbumGrid,
  AlbumTile,
  Artwork,
  TrackList,
  TrackRow,
  WINDOW_FROM,
  WindowedAlbumGrid,
} from '../ui/media.tsx';
import { BlockEmpty, BlockError, FreshnessNote, GridLoading, RowsLoading } from '../ui/states.tsx';
import type { LibraryTab } from '../view.ts';
import { Link } from './link.tsx';

// S2 Library, S6 Album detail and S3 Search (PRODUCT_SPEC.md §6.3, §6.4) over the library source.
// Without one (production until M5) they show their empty states.

const albumContext = (a: Album): PlayContext => ({ kind: 'album', id: a.id, title: a.title });
const artistsOf = (t: Track) => t.artists.map((a) => a.name).join(', ');

/** Rows of a track list, wired to the controller: click plays the list from that row. */
function Rows({
  tracks,
  context,
  numbered,
}: {
  tracks: Track[];
  context: PlayContext;
  numbered?: boolean;
}) {
  const c = usePlayback();
  const p = usePlayer((s) => s);
  const live = p.status !== 'idle' && p.status !== 'ended';
  return tracks.map((t, i) => {
    const now = live && p.track?.key === t.key;
    return (
      <TrackRow
        key={t.key}
        number={numbered ? i + 1 : undefined}
        title={t.title}
        artist={artistsOf(t)}
        durationMs={t.durationMs}
        artwork={numbered ? undefined : { src: t.artwork[0]?.url, album: t.album.title }}
        nowPlaying={now}
        // The decay trace (§2.3) sits on the row playback started from, fading over the song.
        decay={
          now
            ? {
                durationMs: t.durationMs,
                elapsedMs: positionNow(p, performance.now()),
                paused: p.status !== 'playing',
              }
            : undefined
        }
        onPlay={() => c.playList(tracks, i, context)}
        menu={[
          { label: strings.album.playNext, onSelect: () => c.playNext([t], t.title) },
          { label: strings.album.addToQueue, onSelect: () => c.addToQueue([t], t.title) },
        ]}
      />
    );
  });
}

function Albums({ albums }: { albums: Album[] }) {
  const c = usePlayback();
  const library = useLibrary();
  // A server library lists albums before their tracks: fetch them on the first play.
  const play = async (a: Album) => {
    const full = a.tracks.length ? a : await library?.loadAlbum?.(a.id).catch(() => null);
    if (full === null) return toastStore.getState().show(strings.states.albumFailed);
    const album = full ?? a;
    c.playList(album.tracks, 0, albumContext(album));
  };
  const tile = (a: Album) => (
    <AlbumTile
      key={a.id}
      id={a.id}
      title={a.title}
      artist={a.artist}
      cover={a.cover}
      onPlay={() => void play(a)}
    />
  );
  // A large library is windowed (LIB-02); a small one stays a plain grid.
  if (albums.length > WINDOW_FROM) return <WindowedAlbumGrid items={albums} render={tile} />;
  return <AlbumGrid>{albums.map(tile)}</AlbumGrid>;
}

export function LibraryContent({ tab }: { tab: LibraryTab }) {
  const library = useLibrary();
  const s = strings.library;
  if (!library)
    return (
      <BlockEmpty
        text={s.empty}
        action={
          <Link className={buttonClass('secondary')} to={{ view: 'settings', section: 'account' }}>
            {strings.states.connectServer}
          </Link>
        }
      />
    );
  const status = library.status?.() ?? 'ready';
  if (tab === 'albums')
    return (
      <>
        {library.setSort && <SortSwitch />}
        <FreshnessNote loadedAt={library.loadedAt?.()} />
        {status === 'loading' && !library.albums.length ? (
          <GridLoading />
        ) : status === 'error' && !library.albums.length ? (
          <BlockError what={strings.states.libraryFailed} onRetry={library.retry} />
        ) : library.albums.length ? (
          <Albums albums={library.albums} />
        ) : (
          <p className="empty">{s.empty}</p>
        )}
      </>
    );
  if (tab === 'playlists' && library.playlists) return <Playlists />;
  if (tab === 'starred' && library.starred) return <Starred />;
  if (tab === 'artists') {
    // Derived from the album list, so the counts are only true once every page has loaded.
    if (status === 'loading') return <RowsLoading label={s.tabs.artists} />;
    // By id where the library has one (each row then links to the artist's page, S6), else by name.
    const artists = new Map<string, { name: string; id?: string; n: number }>();
    for (const a of library.albums) {
      const key = a.artistId ?? `name:${a.artist}`;
      const known = artists.get(key);
      if (known) known.n++;
      else artists.set(key, { name: a.artist.trim(), id: a.artistId, n: 1 });
    }
    if (!artists.size) return <p className="empty">{s.noArtists}</p>;
    return (
      <ul className="artist-list">
        {[...artists]
          .sort(([, a], [, b]) => a.name.localeCompare(b.name))
          .map(([key, a]) => (
            <li key={key}>
              {a.id ? (
                <Link className={buttonClass('tertiary')} to={{ view: 'artist', id: a.id }}>
                  {a.name}
                </Link>
              ) : (
                <span>{a.name}</span>
              )}
              <span className="artist-count">{s.albumCount(a.n)}</span>
            </li>
          ))}
      </ul>
    );
  }
  return <p className="empty">{tab === 'playlists' ? s.noPlaylists : s.noStarred}</p>;
}

/** The album order (PRODUCT_SPEC.md §6.3): recently added, A–Z, year, most played. */
function SortSwitch() {
  const library = useLibrary();
  const current = library?.sort?.();
  return (
    <fieldset className="view-switch album-sort">
      <legend className="visually-hidden">{strings.library.sortLabel}</legend>
      {ALBUM_SORTS.map((sort) => (
        <button
          key={sort}
          type="button"
          aria-pressed={current === sort}
          onClick={() => library?.setSort?.(sort)}
        >
          {strings.library.sorts[sort]}
        </button>
      ))}
    </fieldset>
  );
}

/** A server library's playlists: each row plays its playlist. */
function Playlists() {
  const library = useLibrary();
  const c = usePlayback();
  const [list, setList] = useState<Playlist[] | 'error' | null>(null);
  const load = useCallback(() => {
    setList(null);
    void library?.playlists?.().then(setList, () => setList('error'));
  }, [library]);
  useEffect(load, [load]);
  if (!list) return <RowsLoading label={strings.library.tabs.playlists} />;
  if (list === 'error') return <BlockError what={strings.states.playlistsFailed} onRetry={load} />;
  if (!list.length) return <p className="empty">{strings.library.noPlaylists}</p>;
  const play = async (p: Playlist) => {
    const tracks = (await library?.playlistTracks?.(p.id)) ?? [];
    c.playList(tracks, 0, { kind: 'playlist', id: p.id, title: p.name });
  };
  return (
    <ul className="artist-list">
      {list.map((p) => (
        <li key={p.id}>
          <Button variant="tertiary" onClick={() => void play(p)}>
            {p.name}
          </Button>
          <span className="artist-count">{strings.album.trackCount(p.tracks)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A server library's starred tracks. */
function Starred() {
  const library = useLibrary();
  const [tracks, setTracks] = useState<Track[] | 'error' | null>(null);
  const load = useCallback(() => {
    setTracks(null);
    void library?.starred?.().then(setTracks, () => setTracks('error'));
  }, [library]);
  useEffect(load, [load]);
  if (!tracks) return <RowsLoading label={strings.library.tabs.starred} media />;
  if (tracks === 'error') return <BlockError what={strings.states.starredFailed} onRetry={load} />;
  if (!tracks.length) return <p className="empty">{strings.library.noStarred}</p>;
  return (
    <TrackList label={strings.library.tabs.starred}>
      <Rows tracks={tracks} context={{ kind: 'starred', title: strings.library.tabs.starred }} />
    </TrackList>
  );
}

/** S6: object header (cover 240px, title, artist, year, count, length, actions), track table. */
export function AlbumView({ id }: { id: string }) {
  const library = useLibrary();
  const c = usePlayback();
  const a = library?.album(id);
  // A server library fetches the album (and its tracks) when it is opened: until then, its
  // skeleton, not "missing".
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>(
    library?.loadAlbum ? 'loading' : 'ready',
  );
  const fetchAlbum = useCallback(() => {
    if (!library?.loadAlbum) return setLoad('ready');
    setLoad('loading');
    library.loadAlbum(id).then(
      () => setLoad('ready'),
      () => setLoad('error'),
    );
  }, [library, id]);
  useEffect(fetchAlbum, [fetchAlbum]);
  const s = strings.album;
  // While this album is what plays, its Play button controls it instead of restarting it.
  const status = usePlayer((p) => p.status);
  const isCurrent = useQueue((q) => q.contextSource?.kind === 'album' && q.contextSource.id === id);
  const live = isCurrent && status !== 'idle' && status !== 'ended';
  const playing = live && ['playing', 'loading', 'buffering'].includes(status);
  if (!a && load === 'loading') return <AlbumLoading />;
  // Its tracks could not be fetched: an error with Retry, never "0 tracks" or "not in your library".
  if (load === 'error' && !a?.tracks.length)
    return (
      <>
        <h1 tabIndex={-1}>{a?.title ?? s.title}</h1>
        <BlockError what={strings.states.albumFailed} onRetry={fetchAlbum} />
      </>
    );
  if (!a)
    return (
      <>
        <h1 tabIndex={-1}>{s.title}</h1>
        <p className="empty">{s.missing}</p>
      </>
    );
  return (
    <>
      <header className="detail-head">
        <Artwork size="detail" src={a.cover} title={a.title} />
        <div className="detail-meta">
          <h1 tabIndex={-1}>{a.title}</h1>
          <p className="detail-artist">
            {a.artistId ? (
              <Link to={{ view: 'artist', id: a.artistId }}>{a.artist}</Link>
            ) : (
              a.artist
            )}
          </p>
          <p className="detail-facts">
            {[a.year, s.trackCount(a.tracks.length)].filter(Boolean).join(' · ')} ·{' '}
            <span className="num">{formatTime(albumDurationMs(a))}</span>
          </p>
          <div className="detail-actions">
            <Button
              variant="primary"
              onClick={live ? c.toggle : () => c.playList(a.tracks, 0, albumContext(a))}
            >
              {playing ? s.pause : s.play}
            </Button>
            <Button onClick={() => c.playList(a.tracks, 'shuffle', albumContext(a))}>
              {s.shuffle}
            </Button>
            <Button variant="tertiary" onClick={() => c.addToQueue(a.tracks, a.title)}>
              {s.addToQueue}
            </Button>
          </div>
        </div>
      </header>
      {load === 'loading' && !a.tracks.length ? (
        <RowsLoading label={a.title} />
      ) : (
        <TrackList label={a.title} ruled>
          <Rows tracks={a.tracks} context={albumContext(a)} numbered />
        </TrackList>
      )}
    </>
  );
}

/** S6 while the album loads: the header and rows in flat bars at their real sizes (§10). */
function AlbumLoading() {
  return (
    <>
      <header className="detail-head" aria-busy="true">
        <span className="art art--detail" aria-hidden="true" />
        <div className="detail-meta" aria-hidden="true">
          <span className="bar bar--body" />
          <span className="bar bar--small" />
        </div>
      </header>
      <RowsLoading label={strings.album.title} />
    </>
  );
}

/**
 * S6 "by this artist" (PRODUCT_SPEC.md §6.3): their albums, from the server. The name shows at once
 * when the album list already knows it; loading, error (with Retry) and not-found states (DS-07).
 */
export function ArtistView({ id }: { id: string }) {
  const library = useLibrary();
  const known = library?.albums.find((a) => a.artistId === id)?.artist.trim();
  const [artist, setArtist] = useState<
    { name: string; albums: Album[] } | 'loading' | 'error' | null
  >('loading');
  const fetchArtist = useCallback(() => {
    if (!library?.artist) return setArtist(null);
    setArtist('loading');
    library.artist(id).then(
      (a) => setArtist(a ?? null),
      () => setArtist('error'),
    );
  }, [library, id]);
  useEffect(fetchArtist, [fetchArtist]);
  const s = strings.artist;
  // One header in every state, so nothing shifts when the albums arrive (DS-07).
  const head = (name: string, facts: ReactNode) => (
    <header className="detail-head" aria-busy={artist === 'loading' || undefined}>
      <div className="detail-meta">
        <h1 tabIndex={-1}>{name}</h1>
        <p className="detail-facts">{facts}</p>
      </div>
    </header>
  );
  if (artist === 'loading')
    return (
      <>
        {head(known ?? s.title, <span className="bar bar--small" aria-hidden="true" />)}
        <GridLoading count={6} />
      </>
    );
  if (artist === 'error')
    return (
      <>
        {head(known ?? s.title, null)}
        <BlockError what={strings.states.artistFailed} onRetry={fetchArtist} />
      </>
    );
  if (!artist)
    return (
      <>
        <h1 tabIndex={-1}>{s.title}</h1>
        <p className="empty">{s.missing}</p>
      </>
    );
  return (
    <>
      {head(artist.name.trim(), strings.library.albumCount(artist.albums.length))}
      <Albums albums={artist.albums} />
    </>
  );
}

const RESULTS = 6; // per group (PRODUCT_SPEC.md §6.4)
const PROVIDER_NAMES = { navidrome: 'Navidrome', spotify: 'Spotify' } as const;

/**
 * Search results, with one live region that is always there (a status inserted together with its
 * text is often not announced): the count, or "no results", while focus stays in the field.
 */
export function SearchResults({ q }: { q: string }) {
  const [said, setSaid] = useState('');
  return (
    <>
      <p className="visually-hidden" role="status">
        {said}
      </p>
      <SearchBody q={q} onResult={setSaid} />
    </>
  );
}

function SearchBody({ q, onResult }: { q: string; onResult: (said: string) => void }) {
  const library = useLibrary();
  const s = strings.search;
  // A server library searches on the server, 200 ms after typing stops (PRODUCT_SPEC.md §6.4).
  const [remote, setRemote] = useState<{
    q: string;
    tracks: Track[];
    albums: Album[];
    failed?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the search (Retry)
  useEffect(() => {
    if (!library?.searchRemote || !q) return;
    // An answer that arrives after the query changed is dropped: a slow reply to "lana" must not
    // replace the results for "lana del rey" (QA on a real library, 2026-10-28).
    let current = true;
    const id = setTimeout(() => {
      void library.searchRemote?.(q).then(
        (r) => current && setRemote({ q, ...r }),
        () => current && setRemote({ q, tracks: [], albums: [], failed: true }),
      );
    }, 200);
    return () => {
      current = false;
      clearTimeout(id);
    };
  }, [library, q, attempt]);
  // The answer for `q`, once there is one (a server search answers 200 ms after typing stops).
  const found = !q
    ? null
    : library?.searchRemote
      ? remote?.q === q
        ? remote
        : null
      : (library?.search(q) ?? { tracks: [], albums: [] });
  // Grouped by provider, Navidrome first, each group marked when both appear (SRCH-02).
  const groups = (['navidrome', 'spotify'] as const)
    .map((provider) => ({
      provider,
      tracks: (found?.tracks ?? []).filter((t) => t.provider === provider).slice(0, RESULTS),
      albums: (found?.albums ?? [])
        .filter((a) => a.id.startsWith('spotify:') === (provider === 'spotify'))
        .slice(0, RESULTS),
    }))
    .filter((g) => g.tracks.length || g.albums.length);
  const shown = groups.reduce((n, g) => n + g.tracks.length + g.albums.length, 0);
  // A failure says so itself (role="alert"); nothing is said while there is no answer yet.
  const said = !found || remote?.failed ? '' : s.found(shown);
  useEffect(() => onResult(said), [onResult, said]);
  if (!q) return <p className="empty">{s.prompt}</p>;
  if (!found) return <RowsLoading label={s.tracks} media />;
  if (remote?.failed && remote.q === q)
    return (
      <BlockError
        what={strings.states.searchFailed}
        onRetry={() => {
          setRemote(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  if (!shown) return <p className="empty">{s.none(q)}</p>;
  const marked = groups.length > 1;
  return groups.map((g) => {
    const mark = marked ? <ProviderMark>{PROVIDER_NAMES[g.provider]}</ProviderMark> : null;
    return (
      <div key={g.provider} className="results-group" data-provider={g.provider}>
        {g.tracks.length > 0 && (
          <section className="results" aria-labelledby={`results-tracks-${g.provider}`}>
            <h2 id={`results-tracks-${g.provider}`}>
              {s.tracks} {mark}
            </h2>
            <TrackList label={s.tracks}>
              <Rows tracks={g.tracks} context={{ kind: 'search', title: q }} />
            </TrackList>
          </section>
        )}
        {g.albums.length > 0 && (
          <section className="results" aria-labelledby={`results-albums-${g.provider}`}>
            <h2 id={`results-albums-${g.provider}`}>
              {s.albums} {mark}
            </h2>
            <Albums albums={g.albums} />
          </section>
        )}
      </div>
    );
  });
}
