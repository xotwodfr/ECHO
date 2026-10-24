import { useEffect, useState } from 'react';
import type { PlayContext, Track } from '../../shared/types.ts';
import { ALBUM_SORTS, type Album, albumDurationMs, type Playlist } from '../library.ts';
import { useLibrary, usePlayback, usePlayer, useQueue } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { strings } from '../strings.ts';
import { Button, ProviderMark } from '../ui/controls.tsx';
import { formatTime } from '../ui/logic.ts';
import { AlbumGrid, AlbumTile, Artwork, TrackList, TrackRow } from '../ui/media.tsx';
import type { LibraryTab } from '../view.ts';

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
    const full = a.tracks.length ? a : ((await library?.loadAlbum?.(a.id)) ?? a);
    c.playList(full.tracks, 0, albumContext(full));
  };
  return (
    <AlbumGrid>
      {albums.map((a) => (
        <AlbumTile
          key={a.id}
          id={a.id}
          title={a.title}
          artist={a.artist}
          cover={a.cover}
          onPlay={() => void play(a)}
        />
      ))}
    </AlbumGrid>
  );
}

export function LibraryContent({ tab }: { tab: LibraryTab }) {
  const library = useLibrary();
  const s = strings.library;
  if (!library) return <p className="empty">{s.empty}</p>;
  if (tab === 'albums')
    return (
      <>
        {library.setSort && <SortSwitch />}
        <Albums albums={library.albums} />
      </>
    );
  if (tab === 'playlists' && library.playlists) return <Playlists />;
  if (tab === 'starred' && library.starred) return <Starred />;
  if (tab === 'artists') {
    const counts = new Map<string, number>();
    for (const a of library.albums) counts.set(a.artist, (counts.get(a.artist) ?? 0) + 1);
    if (!counts.size) return <p className="empty">{s.noArtists}</p>;
    return (
      <ul className="artist-list">
        {[...counts]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, n]) => (
            <li key={name}>
              <span>{name}</span>
              <span className="artist-count">{s.albumCount(n)}</span>
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
  const [list, setList] = useState<Playlist[] | null>(null);
  useEffect(() => {
    void library?.playlists?.().then(setList, () => setList([]));
  }, [library]);
  if (!list) return null;
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
  const [tracks, setTracks] = useState<Track[] | null>(null);
  useEffect(() => {
    void library?.starred?.().then(setTracks, () => setTracks([]));
  }, [library]);
  if (!tracks) return null;
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
  useEffect(() => {
    void library?.loadAlbum?.(id);
  }, [library, id]);
  const s = strings.album;
  // While this album is what plays, its Play button controls it instead of restarting it.
  const status = usePlayer((p) => p.status);
  const isCurrent = useQueue((q) => q.contextSource?.kind === 'album' && q.contextSource.id === id);
  const live = isCurrent && status !== 'idle' && status !== 'ended';
  const playing = live && ['playing', 'loading', 'buffering'].includes(status);
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
          <p className="detail-artist">{a.artist}</p>
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
      <TrackList label={a.title} ruled>
        <Rows tracks={a.tracks} context={albumContext(a)} numbered />
      </TrackList>
    </>
  );
}

const RESULTS = 6; // per group (PRODUCT_SPEC.md §6.4)
const PROVIDER_NAMES = { navidrome: 'Navidrome', spotify: 'Spotify' } as const;

export function SearchResults({ q }: { q: string }) {
  const library = useLibrary();
  const s = strings.search;
  // A server library searches on the server, 200 ms after typing stops (PRODUCT_SPEC.md §6.4).
  const [remote, setRemote] = useState<{ q: string; tracks: Track[]; albums: Album[] } | null>(
    null,
  );
  useEffect(() => {
    if (!library?.searchRemote || !q) return;
    const id = setTimeout(() => {
      void library.searchRemote?.(q).then(
        (r) => setRemote({ q, ...r }),
        () => setRemote({ q, tracks: [], albums: [] }),
      );
    }, 200);
    return () => clearTimeout(id);
  }, [library, q]);
  if (!q) return <p className="empty">{s.prompt}</p>;
  if (library?.searchRemote && remote?.q !== q) return null; // waiting for the server
  const found = (library?.searchRemote ? remote : library?.search(q)) ?? { tracks: [], albums: [] };
  if (!found.tracks.length && !found.albums.length) return <p className="empty">{s.none(q)}</p>;
  // Grouped by provider, Navidrome first, each group marked when both appear (SRCH-02).
  const groups = (['navidrome', 'spotify'] as const)
    .map((provider) => ({
      provider,
      tracks: found.tracks.filter((t) => t.provider === provider).slice(0, RESULTS),
      albums: found.albums
        .filter((a) => a.id.startsWith('spotify:') === (provider === 'spotify'))
        .slice(0, RESULTS),
    }))
    .filter((g) => g.tracks.length || g.albums.length);
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
