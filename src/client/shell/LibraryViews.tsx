import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { PlayContext, Track } from '../../shared/types.ts';
import {
  ALBUM_SORTS,
  type Album,
  type ArtistInfo,
  albumDurationMs,
  type Genre,
  type PlaylistDetail,
} from '../library.ts';
import { useLibrary, usePlayback, usePlayer, useQueue } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { strings } from '../strings.ts';
import { Button, buttonClass, Field, IconButton, ProviderMark } from '../ui/controls.tsx';
import { Icon } from '../ui/icons.tsx';
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
import { ConfirmDialog, Menu, type MenuItem, Sheet } from '../ui/overlays.tsx';
import { BlockEmpty, BlockError, FreshnessNote, GridLoading, RowsLoading } from '../ui/states.tsx';
import type { LibraryTab } from '../view.ts';
import {
  refreshPlaylists,
  setStar,
  usePlaylists,
  useStarred,
  useStarredAll,
} from './collections.ts';
import { dragTracks } from './drag.ts';
import { useFresh } from './fresh.ts';
import { HeartButton, SaveAlbumButton } from './hearts.tsx';
import { Link, useView } from './link.tsx';
import { openPicker } from './PlaylistPicker.tsx';
import { startRadio, startSmartShuffle } from './radio.ts';
import { useTint } from './tint.ts';

// The pages after Spotify's (docs/superpowers/specs/2026-10-29-spotify-redesign-design.md): Album,
// Artist, Playlist, Liked Songs, Genre and Search. A page opens with a header tinted by its cover,
// a big title and the action row (the green play button first), then its rows or cards. A top
// bar with the play button and the title slides in at the top once the header scrolls away.

const albumContext = (a: Album): PlayContext => ({ kind: 'album', id: a.id, title: a.title });
const artistsOf = (t: Track) => t.artists.map((a) => a.name).join(', ');
const ACTIVE = ['playing', 'loading', 'buffering'];

/** A title's size steps down with its length, as Spotify's (96/72/48/32 px). */
const lengthOf = (title: string) =>
  title.length <= 12 ? 'xl' : title.length <= 24 ? 'l' : title.length <= 40 ? 'm' : 's';

/** Whether this context is what plays, and whether it is playing now. */
export function useContextPlaying(match: (ctx: PlayContext | null) => boolean) {
  const status = usePlayer((p) => p.status);
  const isCurrent = useQueue((q) => match(q.contextSource ?? null));
  const live = isCurrent && status !== 'idle' && status !== 'ended';
  return { live, playing: live && ACTIVE.includes(status) };
}

/** Spotify's big green play button; while its context plays it pauses and resumes it instead. */
export function PlayXL(p: {
  label: string;
  live: boolean;
  playing: boolean;
  onPlay: () => void;
  size?: 'xl' | 'md';
}) {
  const c = usePlayback();
  return (
    <button
      type="button"
      className={`play-xl${p.size === 'md' ? ' play-xl--md' : ''}`}
      aria-label={p.playing ? strings.album.pauseName(p.label) : strings.album.playName(p.label)}
      onClick={p.live ? c.toggle : p.onPlay}
    >
      <Icon name={p.playing ? 'pause' : 'play'} solid />
    </button>
  );
}

/**
 * The tinted header (cover, kind, big title, facts) and, above it, the sticky top bar that
 * appears when the header has scrolled out of the canvas.
 */
export function PageHead(p: {
  kind: string;
  title: string;
  art: ReactNode;
  facts: ReactNode;
  tint: string | null;
  play?: { live: boolean; playing: boolean; onPlay: () => void };
  hero?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    const root = el?.closest('.canvas');
    if (!el || !root) return;
    // Past once the header is under the sticky bar (--sticky-h) at the canvas's top.
    const bar = getComputedStyle(el).getPropertyValue('--sticky-h').trim();
    const io = new IntersectionObserver(([e]) => setPast(!e?.isIntersecting), {
      root,
      rootMargin: `-${bar} 0% 0% 0%`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const tint = p.tint ? ({ '--tint': p.tint } as CSSProperties) : undefined;
  return (
    <>
      <div
        className="sticky-head"
        data-shown={past || undefined}
        data-tint={!!p.tint || undefined}
        style={tint}
      >
        <div className="sticky-bar" inert={!past}>
          {p.play && <PlayXL label={p.title} size="md" {...p.play} />}
          <span className="sticky-title">{p.title}</span>
        </div>
      </div>
      <header
        ref={ref}
        className={`page-head${p.hero ? ' page-head--hero' : ''}`}
        data-tint={!!p.tint || undefined}
        style={tint}
        aria-busy={p.busy || undefined}
      >
        {p.art}
        <div className="ph-text">
          <p className="ph-kind">{p.kind}</p>
          <h1 className="ph-title" data-len={lengthOf(p.title)} tabIndex={-1}>
            {p.title}
          </h1>
          <p className="ph-facts">{p.facts}</p>
        </div>
      </header>
    </>
  );
}

/** The page body under a tinted header: the tint fades out over its first rows. */
export function PageBody({ tint, children }: { tint: string | null; children: ReactNode }) {
  return (
    <div
      className="page-body"
      data-tint={!!tint || undefined}
      style={tint ? ({ '--tint': tint } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/** A track's own menu: Spotify's Add to playlist, song radio, queue, and where it came from. */
function useTrackMenu() {
  const c = usePlayback();
  const library = useLibrary();
  const navigate = useView((s) => s.navigate);
  return (t: Track, extra: MenuItem[] = []): MenuItem[] => {
    const nav = t.provider === 'navidrome';
    return [
      ...(nav && library?.updatePlaylist
        ? [{ label: strings.playlist.addTo, onSelect: () => openPicker([t]) }]
        : []),
      ...extra,
      ...(nav && library?.similarSongs
        ? [{ label: strings.radio.go, onSelect: () => void startRadio(c, library, t) }]
        : []),
      { label: strings.album.playNext, onSelect: () => c.playNext([t], t.title) },
      { label: strings.album.addToQueue, onSelect: () => c.addToQueue([t], t.title) },
      ...(nav && t.artists[0]?.id
        ? [
            {
              label: strings.album.goToArtist,
              onSelect: () => navigate({ view: 'artist', id: t.artists[0]?.id ?? '' }),
            },
          ]
        : []),
      ...(nav && t.album.id
        ? [
            {
              label: strings.album.goToAlbum,
              onSelect: () => navigate({ view: 'album', id: t.album.id ?? '' }),
            },
          ]
        : []),
    ];
  };
}

/** Rows of a track list, wired to the controller: click plays the list from that row. */
export function Rows({
  tracks,
  context,
  numbered,
  art,
  extraMenu,
}: {
  tracks: Track[];
  context: PlayContext;
  numbered?: boolean;
  /** Covers on the rows (playlists, Liked Songs, search); albums have one cover for all. */
  art?: boolean;
  extraMenu?: (t: Track, i: number) => MenuItem[];
}) {
  const c = usePlayback();
  const p = usePlayer((s) => s);
  const menuOf = useTrackMenu();
  const live = p.status !== 'idle' && p.status !== 'ended';
  return tracks.map((t, i) => {
    const now = live && p.track?.key === t.key;
    return (
      <TrackRow
        // biome-ignore lint/suspicious/noArrayIndexKey: a playlist can hold the same song twice
        key={`${t.key}-${i}`}
        number={numbered ? i + 1 : undefined}
        title={t.title}
        artist={artistsOf(t)}
        durationMs={t.durationMs}
        artwork={art ? { src: t.artwork[0]?.url, album: t.album.title } : undefined}
        nowPlaying={now}
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
        heart={<HeartButton track={t} />}
        menu={menuOf(t, extraMenu?.(t, i))}
        rowProps={dragTracks([t])}
      />
    );
  });
}

function useAlbumPlay() {
  const c = usePlayback();
  const library = useLibrary();
  // A server library lists albums before their tracks: fetch them on the first play.
  return async (a: Album) => {
    const full = a.tracks.length ? a : await library?.loadAlbum?.(a.id).catch(() => null);
    if (full === null) return toastStore.getState().show(strings.states.albumFailed);
    const album = full ?? a;
    c.playList(album.tracks, 0, albumContext(album));
  };
}

/** An album card's menu (right-click or its ⋯): Spotify's queue, playlist, save and artist. */
export function useAlbumMenu() {
  const c = usePlayback();
  const library = useLibrary();
  const navigate = useView((s) => s.navigate);
  const starred = useStarredAll();
  const s = strings.album;
  // A server library lists albums before their tracks: fetched when a choice needs them.
  const tracks = async (a: Album) => {
    const full = a.tracks.length ? a : await library?.loadAlbum?.(a.id).catch(() => null);
    if (!full?.tracks.length) toastStore.getState().show(strings.states.albumFailed);
    return full?.tracks ?? [];
  };
  return (a: Album): MenuItem[] => {
    const nav = !a.id.startsWith('spotify:');
    const saved = starred && starred !== 'error' && starred.albums.some((x) => x.id === a.id);
    return [
      {
        label: s.playNext,
        onSelect: () => void tracks(a).then((t) => t.length && c.playNext(t, a.title)),
      },
      {
        label: s.addToQueue,
        onSelect: () => void tracks(a).then((t) => t.length && c.addToQueue(t, a.title)),
      },
      ...(nav && library?.updatePlaylist
        ? [
            {
              label: strings.playlist.addTo,
              onSelect: () => void tracks(a).then((t) => t.length && openPicker(t)),
            },
          ]
        : []),
      ...(nav && library?.setStar
        ? [
            {
              label: saved ? strings.liked.removeAlbum : strings.liked.saveAlbum,
              onSelect: () => void setStar('album', a, !saved),
            },
          ]
        : []),
      ...(a.artistId
        ? [
            {
              label: s.goToArtist,
              onSelect: () => navigate({ view: 'artist', id: a.artistId ?? '' }),
            },
          ]
        : []),
    ];
  };
}

export function Albums({ albums, sub }: { albums: Album[]; sub?: (a: Album) => string }) {
  const play = useAlbumPlay();
  const menu = useAlbumMenu();
  const tile = (a: Album) => (
    <AlbumTile
      key={a.id}
      id={a.id}
      title={a.title}
      artist={sub ? sub(a) : a.artist}
      cover={a.cover}
      onPlay={() => void play(a)}
      menu={menu(a)}
    />
  );
  // A large library is windowed (LIB-02); a small one stays a plain grid.
  if (albums.length > WINDOW_FROM) return <WindowedAlbumGrid items={albums} render={tile} />;
  return <AlbumGrid>{albums.map(tile)}</AlbumGrid>;
}

// ---------------------------------------------------------------------------------------------
// Your Library as a page (wide screens; phones show the list, LibraryPanel)

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

/** A server library's playlists, as cards that open them. */
function Playlists() {
  const playlists = usePlaylists();
  if (playlists === null) return <RowsLoading label={strings.library.tabs.playlists} />;
  if (playlists === 'error')
    return <BlockError what={strings.states.playlistsFailed} onRetry={refreshPlaylists} />;
  if (!playlists.length) return <p className="empty">{strings.library.noPlaylists}</p>;
  return (
    <AlbumGrid>
      {playlists.map((p) => (
        <AlbumTile
          key={p.id}
          id={p.id}
          title={p.name}
          artist={p.owner ?? strings.panel.songs(p.tracks)}
          cover={p.cover}
          to={{ view: 'playlist', id: p.id }}
        />
      ))}
    </AlbumGrid>
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

// ---------------------------------------------------------------------------------------------
// Album

export function AlbumView({ id }: { id: string }) {
  const library = useLibrary();
  const c = usePlayback();
  const navigate = useView((s) => s.navigate);
  const a = library?.album(id);
  // A server library fetches the album (and its tracks) when it is opened: until then, its
  // skeleton, not "missing".
  // An album opened before (its tracks loaded) shows at once and refreshes behind (fresh.ts).
  const loaded = () => !!library?.album(id)?.tracks.length;
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>(
    library?.loadAlbum && !loaded() ? 'loading' : 'ready',
  );
  const fetchAlbum = useCallback(() => {
    if (!library?.loadAlbum) return setLoad('ready');
    const had = !!library.album(id)?.tracks.length;
    if (!had) setLoad('loading');
    library.loadAlbum(id).then(
      () => setLoad('ready'),
      () => !had && setLoad('error'),
    );
  }, [library, id]);
  useEffect(fetchAlbum, [fetchAlbum]);
  const tint = useTint(
    a
      ? a.id.startsWith('spotify:')
        ? `spotify:album:${a.id.slice(8)}`
        : `navidrome:${a.id}`
      : null,
    a?.cover,
  );
  const s = strings.album;
  const { live, playing } = useContextPlaying((x) => x?.kind === 'album' && x.id === id);
  if (!a && load === 'loading') return <PageLoading kind={s.title} />;
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
  const play = () => c.playList(a.tracks, 0, albumContext(a));
  return (
    <>
      <PageHead
        kind={s.title}
        title={a.title}
        tint={tint}
        art={<Artwork size="detail" src={a.cover} title={a.title} />}
        play={{ live, playing, onPlay: play }}
        facts={
          <>
            <span className="ph-strong">
              {a.artistId ? (
                <Link className="detail-artist" to={{ view: 'artist', id: a.artistId }}>
                  {a.artist}
                </Link>
              ) : (
                <span className="detail-artist">{a.artist}</span>
              )}
            </span>
            {[a.year, s.songs(a.tracks.length)].filter(Boolean).map((x) => (
              <span key={String(x)}> • {x}</span>
            ))}
            , <span className="num">{formatTime(albumDurationMs(a))}</span>
          </>
        }
      />
      <PageBody tint={tint}>
        <div className="action-bar">
          <PlayXL label={a.title} live={live} playing={playing} onPlay={play} />
          <IconButton
            size="lg"
            label={s.shuffleName(a.title)}
            icon="shuffle"
            onClick={() => c.playList(a.tracks, 'shuffle', albumContext(a))}
          />
          <SaveAlbumButton album={a} />
          <Menu
            label={s.more(a.title)}
            items={[
              { label: s.addToQueue, onSelect: () => c.addToQueue(a.tracks, a.title) },
              ...(library?.updatePlaylist && !a.id.startsWith('spotify:')
                ? [{ label: strings.playlist.addTo, onSelect: () => openPicker(a.tracks) }]
                : []),
              ...(a.artistId
                ? [
                    {
                      label: s.goToArtist,
                      onSelect: () => navigate({ view: 'artist', id: a.artistId ?? '' }),
                    },
                  ]
                : []),
            ]}
          />
        </div>
        {load === 'loading' && !a.tracks.length ? (
          <RowsLoading label={a.title} />
        ) : (
          <TrackList label={a.title} ruled>
            <Rows tracks={a.tracks} context={albumContext(a)} numbered />
          </TrackList>
        )}
      </PageBody>
    </>
  );
}

/** A page while it loads: the header and rows in flat bars at their real sizes (§10). */
function PageLoading({ kind }: { kind: string }) {
  return (
    <>
      <header className="page-head" aria-busy="true">
        <span className="art art--detail" aria-hidden="true" />
        <div className="ph-text" aria-hidden="true">
          <p className="ph-kind">{kind}</p>
          <span className="bar bar--title" />
          <span className="bar bar--small" />
        </div>
      </header>
      <RowsLoading label={kind} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Artist

/**
 * Spotify's artist page: the picture as a hero with the name over it, play and follow, Popular,
 * Discography, Fans also like and About. The name shows at once when the album list knows it;
 * loading, error (with Retry) and not-found states (DS-07).
 */
export function ArtistView({ id }: { id: string }) {
  const library = useLibrary();
  const c = usePlayback();
  const known = library?.albums.find((a) => a.artistId === id)?.artist.trim();
  const [artist, reloadArtist] = useFresh(`artist:${id}`, async () =>
    library?.artist ? ((await library.artist(id)) ?? null) : null,
  );
  const fetchArtist = () => void reloadArtist();
  const [about] = useFresh(
    `artist-info:${id}`,
    async () => (await library?.artistInfo?.(id)) ?? null,
  );
  const info: ArtistInfo | null = typeof about === 'object' ? about : null;
  const name = typeof artist === 'object' && artist ? artist.name.trim() : known;
  const [popular] = useFresh(`top:${name ?? ''}`, async () =>
    name && library?.topSongs ? library.topSongs(name, 10).catch(() => []) : [],
  );
  const top: Track[] | null = Array.isArray(popular) ? popular : null;
  const first = typeof artist === 'object' && artist ? artist.albums[0] : undefined;
  const tint = useTint(first ? `navidrome:${first.id}` : null);
  const s = strings.artist;
  const { live, playing } = useContextPlaying((x) => x?.kind === 'artist' && x.id === id);
  const following = useStarred('artist', id);
  const shown = top?.length ? top : null;
  const ctx: PlayContext = { kind: 'artist', id, title: name ?? s.title };
  const [more, setMore] = useState(false);
  if (artist === 'error')
    return (
      <>
        <h1 tabIndex={-1}>{known ?? s.title}</h1>
        <BlockError what={strings.states.artistFailed} onRetry={fetchArtist} />
      </>
    );
  if (artist === 'loading')
    return (
      <>
        <PageHead
          kind={s.title}
          title={known ?? s.title}
          tint={null}
          art={null}
          facts={<span className="bar bar--small" aria-hidden="true" />}
          hero
          busy
        />
        <GridLoading count={6} />
      </>
    );
  if (!artist)
    return (
      <>
        <h1 tabIndex={-1}>{s.title}</h1>
        <p className="empty">{s.missing}</p>
      </>
    );
  const playAll = async () => {
    if (shown) return c.playList(shown, 0, ctx);
    const tracks = (
      await Promise.all(artist.albums.map((a) => library?.loadAlbum?.(a.id).catch(() => a) ?? a))
    ).flatMap((a) => a?.tracks ?? []);
    if (tracks.length) c.playList(tracks, 0, ctx);
  };
  return (
    <>
      <PageHead
        kind={s.title}
        title={artist.name.trim()}
        tint={tint}
        hero
        art={
          info?.image || first?.cover ? (
            <span className="ph-hero-img" aria-hidden="true">
              <img src={info?.image ?? first?.cover} alt="" />
            </span>
          ) : null
        }
        play={{ live, playing, onPlay: () => void playAll() }}
        facts={strings.library.albumCount(artist.albums.length)}
      />
      <PageBody tint={tint}>
        <div className="action-bar">
          <PlayXL label={artist.name} live={live} playing={playing} onPlay={() => void playAll()} />
          {library?.setStar && (
            <button
              type="button"
              className="follow-btn"
              aria-pressed={following}
              aria-label={following ? s.unfollowName(artist.name) : s.followName(artist.name)}
              onClick={() => void setStar('artist', { id, name: artist.name }, !following)}
            >
              {following ? s.following : s.follow}
            </button>
          )}
        </div>
        {shown && (
          <section className="shelf" aria-labelledby="artist-popular">
            <h2 id="artist-popular">{s.popular}</h2>
            <TrackList label={s.popular}>
              <Rows tracks={more ? shown : shown.slice(0, 5)} context={ctx} numbered art />
            </TrackList>
            {shown.length > 5 && (
              <button type="button" className="text-btn" onClick={() => setMore(!more)}>
                {more ? strings.home.showLess : strings.home.seeMore}
              </button>
            )}
          </section>
        )}
        <section className="shelf" aria-labelledby="artist-discography">
          <h2 id="artist-discography">{s.discography}</h2>
          <Albums
            albums={artist.albums}
            sub={(a) => [a.year, strings.album.title].filter(Boolean).join(' • ')}
          />
        </section>
        {info?.similar.length ? (
          <section className="shelf" aria-labelledby="artist-fans">
            <h2 id="artist-fans">{s.fansAlsoLike}</h2>
            <ul className="album-grid card-row">
              {info.similar.slice(0, 7).map((x) => (
                <AlbumTile
                  key={x.id}
                  id={x.id}
                  title={x.name}
                  artist={s.title}
                  cover={x.image}
                  round
                  to={{ view: 'artist', id: x.id }}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {info?.bio && (
          <section className="shelf about-card" aria-labelledby="artist-about">
            <h2 id="artist-about">{s.about}</h2>
            <p>{info.bio}</p>
          </section>
        )}
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Playlist

/** A playlist's cover: its own, or a mosaic of its first four albums. */
function PlaylistArt({ p }: { p: PlaylistDetail }) {
  if (p.covers.length >= 4)
    return (
      <span className="art art--detail mosaic" aria-hidden="true">
        {p.covers.slice(0, 4).map((src) => (
          <img key={src} src={src} alt="" />
        ))}
      </span>
    );
  if (p.cover || p.covers[0])
    return <Artwork size="detail" src={p.cover ?? p.covers[0]} title={p.name} />;
  return (
    <span className="art art--detail art--empty" aria-hidden="true">
      <Icon name="music" />
    </span>
  );
}

export function PlaylistView({ id }: { id: string }) {
  const library = useLibrary();
  const c = usePlayback();
  const navigate = useView((s) => s.navigate);
  const [p, reload] = useFresh(`playlist:${id}`, async () =>
    library?.playlist ? ((await library.playlist(id)) ?? null) : null,
  );
  const load = () => void reload();
  const firstAlbum = typeof p === 'object' && p ? p.entries[0]?.album.key : undefined;
  const tint = useTint(firstAlbum ?? null);
  const { live, playing } = useContextPlaying((x) => x?.kind === 'playlist' && x.id === id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const s = strings.playlist;
  if (p === 'loading') return <PageLoading kind={s.title} />;
  if (p === 'error')
    return (
      <>
        <h1 tabIndex={-1}>{s.title}</h1>
        <BlockError what={s.failedLoad} onRetry={load} />
      </>
    );
  if (!p)
    return (
      <>
        <h1 tabIndex={-1}>{s.title}</h1>
        <p className="empty">{s.missing}</p>
      </>
    );
  const ctx: PlayContext = { kind: 'playlist', id, title: p.name };
  const editable = !!library?.updatePlaylist;
  const change = async (fn: () => Promise<void> | undefined, done?: string) => {
    try {
      await fn();
      if (done) toastStore.getState().show(done);
      load();
      void refreshPlaylists();
    } catch {
      toastStore.getState().show(s.failed);
    }
  };
  return (
    <>
      <PageHead
        kind={s.title}
        title={p.name}
        tint={tint}
        art={<PlaylistArt p={p} />}
        play={
          p.entries.length
            ? { live, playing, onPlay: () => c.playList(p.entries, 0, ctx) }
            : undefined
        }
        facts={
          <>
            {p.comment && <span className="ph-desc">{p.comment}</span>}
            {p.owner && <span className="ph-strong">{p.owner}</span>}
            <span>
              {p.owner ? ' • ' : ''}
              {strings.album.songs(p.entries.length)}
              {p.entries.length > 0 && (
                <>
                  , <span className="num">{formatTime(p.durationMs)}</span>
                </>
              )}
            </span>
          </>
        }
      />
      <PageBody tint={tint}>
        <div className="action-bar">
          {p.entries.length > 0 && (
            <>
              <PlayXL
                label={p.name}
                live={live}
                playing={playing}
                onPlay={() => c.playList(p.entries, 0, ctx)}
              />
              <IconButton
                size="lg"
                label={strings.album.shuffleName(p.name)}
                icon="shuffle"
                onClick={() => c.playList(p.entries, 'shuffle', ctx)}
              />
              <IconButton
                size="lg"
                label={strings.radio.smart(p.name)}
                icon="smartShuffle"
                onClick={() => void startSmartShuffle(c, library, p.entries, ctx)}
              />
            </>
          )}
          {editable && (
            <Menu
              label={strings.album.more(p.name)}
              items={[
                { label: s.edit, onSelect: () => setEditing(true) },
                ...(p.entries.length
                  ? [
                      {
                        label: strings.album.addToQueue,
                        onSelect: () => c.addToQueue(p.entries, p.name),
                      },
                    ]
                  : []),
                { label: s.delete, destructive: true, onSelect: () => setDeleting(true) },
              ]}
            />
          )}
        </div>
        {p.entries.length ? (
          <TrackList label={p.name} ruled>
            <Rows
              tracks={p.entries}
              context={ctx}
              numbered
              art
              extraMenu={
                editable
                  ? (_t, i) => [
                      {
                        label: s.remove,
                        onSelect: () =>
                          void change(
                            () => library?.updatePlaylist?.(id, { remove: [i] }),
                            s.removed(p.name),
                          ),
                      },
                    ]
                  : undefined
              }
            />
          </TrackList>
        ) : (
          <div className="page-empty">
            <h2>{s.empty}</h2>
            <p className="empty">{s.emptyHint}</p>
            <Link className={buttonClass('secondary')} to={{ view: 'search', q: '' }}>
              {strings.nav.search}
            </Link>
          </div>
        )}
      </PageBody>
      <EditPlaylist
        open={editing}
        p={p}
        onClose={() => setEditing(false)}
        onSave={(name, comment) =>
          void change(() => library?.updatePlaylist?.(id, { name, comment })).then(() =>
            setEditing(false),
          )
        }
      />
      <ConfirmDialog
        open={deleting}
        title={s.deleteTitle(p.name)}
        consequence={s.deleteConsequence}
        confirmLabel={s.delete}
        onConfirm={() => {
          setDeleting(false);
          void (async () => {
            try {
              await library?.deletePlaylist?.(id);
              await refreshPlaylists();
              navigate({ view: 'home' }, { replace: true });
            } catch {
              toastStore.getState().show(s.failed);
            }
          })();
        }}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}

function EditPlaylist(props: {
  open: boolean;
  p: PlaylistDetail;
  onClose: () => void;
  onSave: (name: string, comment: string) => void;
}) {
  const [name, setName] = useState(props.p.name);
  const [comment, setComment] = useState(props.p.comment ?? '');
  useEffect(() => {
    if (!props.open) return;
    setName(props.p.name);
    setComment(props.p.comment ?? '');
  }, [props.open, props.p]);
  const s = strings.playlist;
  return (
    <Sheet open={props.open} onClose={props.onClose} title={s.edit}>
      <form
        className="edit-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) props.onSave(name.trim(), comment.trim());
        }}
      >
        <Field
          label={s.name}
          value={name}
          required
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label={s.description}
          value={comment}
          maxLength={300}
          onChange={(e) => setComment(e.target.value)}
        />
        <Button variant="primary" type="submit">
          {s.save}
        </Button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Liked Songs

export function LikedView() {
  const c = usePlayback();
  const library = useLibrary();
  const starred = useStarredAll();
  const s = strings.liked;
  const ctx: PlayContext = { kind: 'starred', title: s.title };
  const { live, playing } = useContextPlaying((x) => x?.kind === 'starred');
  const tracks = starred && starred !== 'error' ? starred.tracks : [];
  return (
    <>
      <PageHead
        kind={strings.playlist.title}
        title={s.title}
        tint={null}
        art={
          <span className="art art--detail liked-art liked-art--xl" aria-hidden="true">
            <Icon name="heart" solid />
          </span>
        }
        play={
          tracks.length ? { live, playing, onPlay: () => c.playList(tracks, 0, ctx) } : undefined
        }
        facts={strings.album.songs(tracks.length)}
      />
      <div className="page-body page-body--liked">
        {tracks.length > 0 && (
          <div className="action-bar">
            <PlayXL
              label={s.title}
              live={live}
              playing={playing}
              onPlay={() => c.playList(tracks, 0, ctx)}
            />
            <IconButton
              size="lg"
              label={strings.album.shuffleName(s.title)}
              icon="shuffle"
              onClick={() => c.playList(tracks, 'shuffle', ctx)}
            />
            <IconButton
              size="lg"
              label={strings.radio.smart(s.title)}
              icon="smartShuffle"
              onClick={() => void startSmartShuffle(c, library, tracks, ctx)}
            />
          </div>
        )}
        {starred === null ? (
          <RowsLoading label={s.title} media />
        ) : starred === 'error' ? (
          <BlockError what={strings.states.starredFailed} onRetry={() => location.reload()} />
        ) : tracks.length ? (
          <TrackList label={s.title} ruled>
            <Rows tracks={tracks} context={ctx} numbered art />
          </TrackList>
        ) : (
          <div className="page-empty">
            <Icon name="heart" />
            <h2>{s.empty}</h2>
            <p className="empty">{s.emptyHint}</p>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Genres and search

/** A genre's card colour: a fixed set, picked by name, so a genre keeps its colour. */
const GENRE_COLOURS = 12;
const genreColour = (name: string) =>
  [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % GENRE_COLOURS;

function BrowseAll() {
  const library = useLibrary();
  const [v, reload] = useFresh('genres', async () => (library?.genres ? library.genres() : []));
  const genres = v === 'loading' ? null : v;
  const load = () => void reload();
  if (genres === null) return <GridLoading count={8} />;
  if (genres === 'error') return <BlockError what={strings.genre.failed} onRetry={load} />;
  if (!genres.length) return <p className="empty">{strings.search.prompt}</p>;
  return (
    <section aria-labelledby="browse-all">
      <h2 id="browse-all">{strings.genre.browse}</h2>
      <ul className="genre-grid">
        {genres.map((g) => (
          <li key={g.name} className="genre-card" data-hue={genreColour(g.name)}>
            <Link to={{ view: 'genre', name: g.name }}>
              <span className="genre-name">{g.name}</span>
              <span className="genre-count">{strings.genre.albums(g.albums)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GenreView({ name }: { name: string }) {
  const library = useLibrary();
  const [v, reload] = useFresh(`genre:${name}`, async () =>
    library?.genreAlbums ? library.genreAlbums(name) : [],
  );
  const albums = v === 'loading' ? null : v;
  const load = () => void reload();
  return (
    <>
      <header className="page-head page-head--plain genre-head" data-hue={genreColour(name)}>
        <div className="ph-text">
          <p className="ph-kind">{strings.genre.title}</p>
          <h1 className="ph-title" data-len={lengthOf(name)} tabIndex={-1}>
            {name}
          </h1>
        </div>
      </header>
      <div className="page-body">
        {albums === null ? (
          <GridLoading />
        ) : albums === 'error' ? (
          <BlockError what={strings.states.blockFailed} onRetry={load} />
        ) : (
          <Albums albums={albums} />
        )}
      </div>
    </>
  );
}

const RESULTS = 6; // per group (PRODUCT_SPEC.md §6.4)
const PROVIDER_NAMES = { navidrome: 'Navidrome', spotify: 'Spotify' } as const;

/**
 * Search: Browse all (genre cards) until something is typed, then the results. One live region
 * that is always there (a status inserted together with its text is often not announced): the
 * count, or "no results", while focus stays in the field.
 */
export function SearchResults({ q }: { q: string }) {
  const [said, setSaid] = useState('');
  return (
    <>
      <p className="visually-hidden" role="status">
        {said}
      </p>
      {q ? <SearchBody q={q} onResult={setSaid} /> : <BrowseAll />}
    </>
  );
}

type Found = {
  tracks: Track[];
  albums: Album[];
  artists?: { id: string; name: string; image?: string }[];
};

function SearchBody({ q, onResult }: { q: string; onResult: (said: string) => void }) {
  const library = useLibrary();
  const play = useAlbumPlay();
  const c = usePlayback();
  const s = strings.search;
  // A server library searches on the server, 200 ms after typing stops (PRODUCT_SPEC.md §6.4).
  // Each answer names the library that gave it: after the switch flips, the other source's results
  // are never shown while the new search runs.
  const [remote, setRemote] = useState<
    (Found & { q: string; from: unknown; failed?: boolean }) | null
  >(null);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the search (Retry)
  useEffect(() => {
    if (!library?.searchRemote || !q) return;
    // An answer that arrives after the query changed is dropped: a slow reply to "lana" must not
    // replace the results for "lana del rey" (QA on a real library, 2026-10-28).
    let current = true;
    const id = setTimeout(() => {
      void library.searchRemote?.(q).then(
        (r) => current && setRemote({ q, from: library, ...r }),
        () => current && setRemote({ q, from: library, tracks: [], albums: [], failed: true }),
      );
    }, 200);
    return () => {
      current = false;
      clearTimeout(id);
    };
  }, [library, q, attempt]);
  // The answer for `q`, once there is one (a server search answers 200 ms after typing stops).
  const found: Found | null = !q
    ? null
    : library?.searchRemote
      ? remote?.q === q && remote.from === library
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
      artists: provider === 'navidrome' ? (found?.artists ?? []).slice(0, RESULTS) : [],
    }))
    .filter((g) => g.tracks.length || g.albums.length || g.artists.length);
  const shown = groups.reduce(
    (n, g) => n + g.tracks.length + g.albums.length + g.artists.length,
    0,
  );
  // A failure says so itself (role="alert"); nothing is said while there is no answer yet.
  const said = !found || remote?.failed ? '' : s.found(shown);
  useEffect(() => onResult(said), [onResult, said]);
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
  return groups.map((g, gi) => {
    const mark = marked ? <ProviderMark>{PROVIDER_NAMES[g.provider]}</ProviderMark> : null;
    const top =
      gi === 0
        ? g.artists[0]
          ? { artist: g.artists[0] }
          : g.albums[0]
            ? { album: g.albums[0] }
            : null
        : null;
    return (
      <div key={g.provider} className="results-group" data-provider={g.provider}>
        {(top || g.tracks.length > 0) && (
          <div className="results-top">
            {top && (
              <section className="results top-result" aria-labelledby={`results-top-${g.provider}`}>
                <h2 id={`results-top-${g.provider}`}>{s.topResult}</h2>
                {'artist' in top && top.artist ? (
                  <Link className="top-card" to={{ view: 'artist', id: top.artist.id }}>
                    <span className="round">
                      <Artwork size="grid" src={top.artist.image} title={top.artist.name} />
                    </span>
                    <span className="top-name">{top.artist.name}</span>
                    <span className="top-kind">{strings.artist.title}</span>
                  </Link>
                ) : 'album' in top && top.album ? (
                  <div className="top-card-wrap">
                    <Link className="top-card" to={{ view: 'album', id: top.album.id }}>
                      <Artwork size="grid" src={top.album.cover} title={top.album.title} />
                      <span className="top-name">{top.album.title}</span>
                      <span className="top-kind">
                        {strings.album.title} • {top.album.artist}
                      </span>
                    </Link>
                    <button
                      type="button"
                      className="play-xl play-xl--md top-play"
                      aria-label={strings.album.playName(top.album.title)}
                      onClick={() => void play(top.album as Album)}
                    >
                      <Icon name="play" solid />
                    </button>
                  </div>
                ) : null}
              </section>
            )}
            {g.tracks.length > 0 && (
              <section className="results" aria-labelledby={`results-tracks-${g.provider}`}>
                <h2 id={`results-tracks-${g.provider}`}>
                  {s.songs} {mark}
                </h2>
                <TrackList label={s.tracks}>
                  <Rows tracks={g.tracks.slice(0, 4)} context={{ kind: 'search', title: q }} art />
                </TrackList>
              </section>
            )}
          </div>
        )}
        {g.artists.length > 0 && (
          <section className="results" aria-labelledby={`results-artists-${g.provider}`}>
            <h2 id={`results-artists-${g.provider}`}>{s.artists}</h2>
            <ul className="album-grid card-row">
              {g.artists.map((x) => (
                <AlbumTile
                  key={x.id}
                  id={x.id}
                  title={x.name}
                  artist={strings.artist.title}
                  cover={x.image}
                  round
                  to={{ view: 'artist', id: x.id }}
                />
              ))}
            </ul>
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
        {g.tracks.length > 4 && (
          <section className="results" aria-labelledby={`results-more-${g.provider}`}>
            <h2 id={`results-more-${g.provider}`} className="visually-hidden">
              {s.tracks}
            </h2>
            <Button
              variant="tertiary"
              onClick={() => c.playList(g.tracks, 0, { kind: 'search', title: q })}
            >
              {strings.album.playName(q)}
            </Button>
          </section>
        )}
      </div>
    );
  });
}
