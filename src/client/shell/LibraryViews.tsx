import type { PlayContext, Track } from '../../shared/types.ts';
import { type Album, albumDurationMs } from '../library.ts';
import { useLibrary, usePlayback, usePlayer } from '../playback/context.tsx';
import { positionNow } from '../playback/controller.ts';
import { strings } from '../strings.ts';
import { Button } from '../ui/controls.tsx';
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
  return (
    <AlbumGrid>
      {albums.map((a) => (
        <AlbumTile
          key={a.id}
          id={a.id}
          title={a.title}
          artist={a.artist}
          cover={a.cover}
          onPlay={() => c.playList(a.tracks, 0, albumContext(a))}
        />
      ))}
    </AlbumGrid>
  );
}

export function LibraryContent({ tab }: { tab: LibraryTab }) {
  const library = useLibrary();
  const s = strings.library;
  if (!library) return <p className="empty">{s.empty}</p>;
  if (tab === 'albums') return <Albums albums={library.albums} />;
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

/** S6: object header (cover 240px, title, artist, year, count, length, actions), track table. */
export function AlbumView({ id }: { id: string }) {
  const library = useLibrary();
  const c = usePlayback();
  const a = library?.album(id);
  const s = strings.album;
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
            <Button variant="primary" onClick={() => c.playList(a.tracks, 0, albumContext(a))}>
              {s.play}
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

export function SearchResults({ q }: { q: string }) {
  const library = useLibrary();
  const s = strings.search;
  if (!q) return <p className="empty">{s.prompt}</p>;
  const found = library?.search(q) ?? { tracks: [], albums: [] };
  if (!found.tracks.length && !found.albums.length) return <p className="empty">{s.none(q)}</p>;
  const tracks = found.tracks.slice(0, RESULTS);
  return (
    <>
      {tracks.length > 0 && (
        <section className="results" aria-labelledby="results-tracks">
          <h2 id="results-tracks">{s.tracks}</h2>
          <TrackList label={s.tracks}>
            <Rows tracks={tracks} context={{ kind: 'search', title: q }} />
          </TrackList>
        </section>
      )}
      {found.albums.length > 0 && (
        <section className="results" aria-labelledby="results-albums">
          <h2 id="results-albums">{s.albums}</h2>
          <Albums albums={found.albums.slice(0, RESULTS)} />
        </section>
      )}
    </>
  );
}
