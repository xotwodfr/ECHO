import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { Album, AlbumListKind, ArtistRef } from '../library.ts';
import { useLibrary, usePlayback, usePlayer, useQueue } from '../playback/context.tsx';
import { sourceStore } from '../source.ts';
import { strings } from '../strings.ts';
import { buttonClass } from '../ui/controls.tsx';
import { Icon } from '../ui/icons.tsx';
import { toastStore } from '../ui/logic.ts';
import { AlbumTile, Artwork } from '../ui/media.tsx';
import { BlockEmpty, BlockError, GridLoading } from '../ui/states.tsx';
import type { Route } from '../view.ts';
import { AccountMenu } from './AccountMenu.tsx';
import { usePlaylists, useStarredAll } from './collections.ts';
import { useCompact } from './compact.ts';
import { useFresh } from './fresh.ts';
import { useAlbumMenu } from './LibraryViews.tsx';
import { Link } from './link.tsx';
import { MixArt, WrappedArt } from './MixViews.tsx';
import { trackOf, useJumpBackIn, useMixes } from './mixes.ts';

// Home (Spotify's): a grid of shortcuts to what was played last, then shelves of covers: recently
// played, new in the library, most played, something different, the user's playlists and the
// artists they play. Each shelf is one row of cards (scrolling sideways on phones). Made For You
// and Jump back in come from ECHO's own play history (mixes.ts).

const SHELF = 12;
const SHORTCUTS = 8;

type ShelfKind = 'recent' | 'newest' | 'frequent' | 'random';
type Shelf = { kind: ShelfKind & AlbumListKind; title: string };
const SHELVES: Shelf[] = [
  { kind: 'recent', title: strings.home.recent },
  { kind: 'newest', title: strings.home.newest },
  { kind: 'frequent', title: strings.home.frequent },
  { kind: 'random', title: strings.home.random },
];

function useAlbumList(kind: AlbumListKind) {
  const library = useLibrary();
  // Per source: after the switch flips, the other source's shelves are never shown.
  const source = useStore(sourceStore, (x) => x.source);
  const [v, reload] = useFresh(`home:${source}:${kind}`, async () =>
    library?.albumList ? library.albumList(kind, SHELF) : (library?.albums.slice(0, SHELF) ?? []),
  );
  return [v === 'loading' ? null : v, () => void reload()] as const;
}

function useAlbumPlay() {
  const c = usePlayback();
  const library = useLibrary();
  return async (a: Album) => {
    const full = a.tracks.length ? a : await library?.loadAlbum?.(a.id).catch(() => null);
    if (full === null) return toastStore.getState().show(strings.states.albumFailed);
    const album = full ?? a;
    c.playList(album.tracks, 0, { kind: 'album', id: album.id, title: album.title });
  };
}

/** Spotify's shortcut tile: a small cover and a bold title on a raised strip. */
function Shortcut(p: { to: Route; title: string; art: React.ReactNode; playing?: boolean }) {
  return (
    <li className="shortcut">
      <Link to={p.to}>
        {p.art}
        <span className="shortcut-title" data-playing={p.playing || undefined}>
          {p.title}
        </span>
        {p.playing && <Icon name="volume" className="shortcut-speaker" />}
      </Link>
    </li>
  );
}

function Shortcuts({ recent }: { recent: Album[] }) {
  const library = useLibrary();
  const starred = useStarredAll();
  const source = useQueue((q) => q.contextSource);
  const live = usePlayer((p) => p.status === 'playing');
  const liked = library?.starredAll && starred !== 'error';
  const albums = recent.slice(0, SHORTCUTS - (liked ? 1 : 0));
  if (!albums.length && !liked) return null;
  return (
    <ul className="shortcuts" aria-label={strings.home.shortcuts}>
      {liked && (
        <Shortcut
          to={{ view: 'liked' }}
          title={strings.liked.title}
          playing={live && source?.kind === 'starred'}
          art={
            <span className="liked-art" aria-hidden="true">
              <Icon name="heart" solid />
            </span>
          }
        />
      )}
      {albums.map((a) => (
        <Shortcut
          key={a.id}
          to={{ view: 'album', id: a.id }}
          title={a.title}
          playing={live && source?.kind === 'album' && source.id === a.id}
          art={<Artwork size="shortcut" src={a.cover} title={a.title} />}
        />
      ))}
    </ul>
  );
}

function AlbumShelf({
  shelf,
  albums,
  retry,
}: {
  shelf: Shelf;
  albums: Album[] | 'error' | null;
  retry: () => void;
}) {
  const play = useAlbumPlay();
  const menu = useAlbumMenu();
  const id = `shelf-${shelf.kind}`;
  if (Array.isArray(albums) && !albums.length) return null;
  return (
    <section className="shelf" aria-labelledby={id}>
      <h2 id={id}>{shelf.title}</h2>
      {albums === null ? (
        <GridLoading count={6} />
      ) : albums === 'error' ? (
        <BlockError what={strings.states.blockFailed} onRetry={retry} />
      ) : (
        <ul className="album-grid card-row" aria-label={shelf.title}>
          {albums.map((a) => (
            <AlbumTile
              key={a.id}
              id={a.id}
              title={a.title}
              artist={a.artist}
              cover={a.cover}
              onPlay={() => void play(a)}
              menu={menu(a)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The mixes made from the user's plays, then their year so far (Wrapped). */
function MadeForYouShelf() {
  const c = usePlayback();
  const mixes = useMixes();
  if (!Array.isArray(mixes) || !mixes.length) return null;
  const year = new Date().getFullYear();
  return (
    <section className="shelf" aria-labelledby="shelf-mixes">
      <h2 id="shelf-mixes">{strings.mix.madeForYou}</h2>
      <ul className="album-grid card-row" aria-label={strings.mix.madeForYou}>
        {mixes.map((m) => (
          <AlbumTile
            key={m.id}
            id={m.id}
            title={m.title}
            artist={m.subtitle}
            art={<MixArt mix={m} size="grid" />}
            to={{ view: 'mix', id: m.id }}
            onPlay={() =>
              c.playList(m.tracks.map(trackOf), 0, { kind: 'mix', id: m.id, title: m.title })
            }
          />
        ))}
        <AlbumTile
          id={`wrapped-${year}`}
          title={strings.wrapped.heading(year)}
          artist={strings.wrapped.tile}
          art={<WrappedArt year={year} />}
          to={{ view: 'wrapped' }}
        />
      </ul>
    </section>
  );
}

const ROUTE_OF = {
  album: (id: string): Route => ({ view: 'album', id }),
  playlist: (id: string): Route => ({ view: 'playlist', id }),
  artist: (id: string): Route => ({ view: 'artist', id }),
  mix: (id: string): Route => ({ view: 'mix', id }),
};

/** What was played from lately: albums, playlists, artists and mixes. */
function JumpBackInShelf() {
  const contexts = useJumpBackIn();
  const mixes = useMixes();
  if (contexts.length < 2) return null;
  return (
    <section className="shelf" aria-labelledby="shelf-jump">
      <h2 id="shelf-jump">{strings.mix.jumpBackIn}</h2>
      <ul className="album-grid card-row" aria-label={strings.mix.jumpBackIn}>
        {contexts.map((x) => {
          const mix = x.kind === 'mix' && Array.isArray(mixes) && mixes.find((m) => m.id === x.id);
          return (
            <AlbumTile
              key={`${x.kind}:${x.id}`}
              id={x.id}
              title={x.title ?? ''}
              artist={strings.mix.kinds[x.kind]}
              cover={x.cover}
              round={x.kind === 'artist'}
              art={mix ? <MixArt mix={mix} size="grid" /> : undefined}
              to={ROUTE_OF[x.kind](x.id)}
            />
          );
        })}
      </ul>
    </section>
  );
}

function PlaylistShelf() {
  const playlists = usePlaylists();
  if (!Array.isArray(playlists) || !playlists.length) return null;
  return (
    <section className="shelf" aria-labelledby="shelf-playlists">
      <h2 id="shelf-playlists">{strings.home.playlists}</h2>
      <ul className="album-grid card-row" aria-label={strings.home.playlists}>
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
      </ul>
    </section>
  );
}

/** Spotify's own top artists (Spotify Home), round, each leading to their page. */
function TopArtistShelf() {
  const library = useLibrary();
  const [artists, setArtists] = useState<ArtistRef[]>([]);
  useEffect(() => {
    let current = true;
    void library?.topArtists?.(SHELF).then(
      (a) => current && setArtists(a),
      () => undefined, // a connection without the scope yet: no shelf (Settings asks to reconnect)
    );
    return () => {
      current = false;
    };
  }, [library]);
  if (artists.length < 2) return null;
  return (
    <section className="shelf" aria-labelledby="shelf-top-artists">
      <h2 id="shelf-top-artists">{strings.home.spotify.artists}</h2>
      <ul className="album-grid card-row" aria-label={strings.home.spotify.artists}>
        {artists.map((a) => (
          <AlbumTile
            key={a.id}
            id={a.id}
            title={a.name}
            artist={strings.artist.title}
            cover={a.image}
            round
            to={{ view: 'artist', id: a.id }}
          />
        ))}
      </ul>
    </section>
  );
}

/** Artists of the most played albums, each once. */
function ArtistShelf({ albums }: { albums: Album[] }) {
  const seen = new Map<string, Album>();
  for (const a of albums) if (a.artistId && !seen.has(a.artistId)) seen.set(a.artistId, a);
  if (seen.size < 2) return null;
  return (
    <section className="shelf" aria-labelledby="shelf-artists">
      <h2 id="shelf-artists">{strings.home.artists}</h2>
      <ul className="album-grid card-row" aria-label={strings.home.artists}>
        {[...seen.values()].map((a) => (
          <AlbumTile
            key={a.artistId}
            id={a.artistId ?? a.id}
            title={a.artist}
            artist={strings.artist.title}
            cover={a.cover}
            round
            to={{ view: 'artist', id: a.artistId ?? '' }}
          />
        ))}
      </ul>
    </section>
  );
}

export function HomeView() {
  const library = useLibrary();
  const compact = useCompact();
  // Spotify Home: its shelves come from the user's Spotify history; ECHO's own play history (mixes,
  // Jump back in) is Navidrome's.
  const spotify = useStore(sourceStore, (x) => x.source) === 'spotify';
  const titled = (sh: Shelf): Shelf =>
    spotify && sh.kind !== 'random' ? { ...sh, title: strings.home.spotify[sh.kind] } : sh;
  const [recent, retryRecent] = useAlbumList('recent');
  const [newest, retryNewest] = useAlbumList('newest');
  const [frequent, retryFrequent] = useAlbumList('frequent');
  const [random, retryRandom] = useAlbumList('random');
  const lists = { recent, newest, frequent, random };
  const retries = {
    recent: retryRecent,
    newest: retryNewest,
    frequent: retryFrequent,
    random: retryRandom,
  };
  const shortcutsFrom =
    Array.isArray(recent) && recent.length ? recent : Array.isArray(newest) ? newest : [];
  return (
    <div className="home">
      <div className="home-head">
        {/* Phones have no top bar: the account menu (and the library switch) opens from here. */}
        {compact && <AccountMenu />}
        <h1 className="home-greeting" tabIndex={-1}>
          {strings.home.greeting(new Date().getHours())}
        </h1>
      </div>
      {!library ? (
        <BlockEmpty
          text={strings.library.empty}
          action={
            <Link
              className={buttonClass('secondary')}
              to={{ view: 'settings', section: 'account' }}
            >
              {strings.states.connectServer}
            </Link>
          }
        />
      ) : (
        <>
          <Shortcuts recent={shortcutsFrom} />
          {!spotify && <MadeForYouShelf />}
          {!spotify && <JumpBackInShelf />}
          {SHELVES.slice(0, 2).map((s) => (
            <AlbumShelf
              key={s.kind}
              shelf={titled(s)}
              albums={lists[s.kind]}
              retry={retries[s.kind]}
            />
          ))}
          <PlaylistShelf />
          {SHELVES.slice(2).map((s) => (
            <AlbumShelf
              key={s.kind}
              shelf={titled(s)}
              albums={lists[s.kind]}
              retry={retries[s.kind]}
            />
          ))}
          {spotify ? (
            <TopArtistShelf />
          ) : (
            Array.isArray(frequent) && <ArtistShelf albums={frequent} />
          )}
        </>
      )}
    </div>
  );
}
