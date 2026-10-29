import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { ALBUM_SORTS, type Album, type AlbumSort, type Playlist } from '../library.ts';
import { useLibrary, usePlayer, useQueue } from '../playback/context.tsx';
import { strings } from '../strings.ts';
import { Icon } from '../ui/icons.tsx';
import { Artwork } from '../ui/media.tsx';
import type { Route } from '../view.ts';
import { createPlaylist, usePlaylists, useStarredAll } from './collections.ts';
import { Link, useView } from './link.tsx';
import { type LibraryFilter, panels } from './panels.ts';

// Your Library (DESIGN_SYSTEM.md §5): the left panel on wide screens, the Library page on phones.
// Liked Songs first, then playlists, albums and artists, filtered by chip and by a search, in the
// library's order. Long lists are windowed: only the rows near the viewport are in the DOM.

type Row =
  | { kind: 'liked'; key: string; count: number }
  | { kind: 'playlist'; key: string; p: Playlist }
  | { kind: 'album'; key: string; a: Album }
  | { kind: 'artist'; key: string; id?: string; name: string; cover?: string; albums: number };

const FILTERS: Exclude<LibraryFilter, 'all'>[] = ['playlists', 'albums', 'artists'];

function useRows(filter: LibraryFilter, q: string): Row[] {
  const library = useLibrary();
  // Re-derive when the server library grows (its albums arrive page by page).
  const version = useLibraryVersion();
  const playlists = usePlaylists();
  const starred = useStarredAll();
  return useMemo(() => {
    void version;
    const albums = library?.albums ?? [];
    const needle = q.trim().toLowerCase();
    const hit = (...t: string[]) => !needle || t.some((x) => x.toLowerCase().includes(needle));
    const rows: Row[] = [];
    const liked = starred && starred !== 'error' ? starred.tracks.length : 0;
    if (filter === 'all' || filter === 'playlists') {
      if (library?.starredAll && hit(strings.liked.title))
        rows.push({ kind: 'liked', key: 'liked', count: liked });
      for (const p of Array.isArray(playlists) ? playlists : [])
        if (hit(p.name)) rows.push({ kind: 'playlist', key: `p:${p.id}`, p });
    }
    if (filter === 'all' || filter === 'albums')
      for (const a of albums)
        if (hit(a.title, a.artist)) rows.push({ kind: 'album', key: `a:${a.id}`, a });
    if (filter === 'artists') {
      const artists = new Map<string, Row & { kind: 'artist' }>();
      for (const a of albums) {
        const key = a.artistId ?? `name:${a.artist}`;
        const known = artists.get(key);
        if (known) known.albums++;
        else
          artists.set(key, {
            kind: 'artist',
            key: `r:${key}`,
            id: a.artistId,
            name: a.artist.trim(),
            cover: a.cover,
            albums: 1,
          });
      }
      rows.push(
        ...[...artists.values()]
          .filter((x) => hit(x.name))
          .sort((x, y) => x.name.localeCompare(y.name)),
      );
    }
    return rows;
  }, [library, version, playlists, starred, filter, q]);
}

function useLibraryVersion() {
  const library = useLibrary();
  const [version, setVersion] = useState(() => library?.version?.() ?? 0);
  useLayoutEffect(
    () => library?.subscribe?.(() => setVersion(library.version?.() ?? 0)),
    [library],
  );
  return version;
}

function routeOf(row: Row): Route | null {
  if (row.kind === 'liked') return { view: 'liked' };
  if (row.kind === 'playlist') return { view: 'playlist', id: row.p.id };
  if (row.kind === 'album') return { view: 'album', id: row.a.id };
  return row.id ? { view: 'artist', id: row.id } : null;
}

function LibraryRow({ row }: { row: Row }) {
  const route = useView((s) => s.route);
  const source = useQueue((q) => q.contextSource);
  const live = usePlayer((p) => p.status !== 'idle' && p.status !== 'ended');
  const to = routeOf(row);
  const current =
    (row.kind === 'liked' && route.view === 'liked') ||
    (row.kind === 'playlist' && route.view === 'playlist' && route.id === row.p.id) ||
    (row.kind === 'album' && route.view === 'album' && route.id === row.a.id) ||
    (row.kind === 'artist' && route.view === 'artist' && route.id === row.id);
  const playing =
    live &&
    ((row.kind === 'liked' && source?.kind === 'starred') ||
      (row.kind === 'playlist' && source?.kind === 'playlist' && source.id === row.p.id) ||
      (row.kind === 'album' && source?.kind === 'album' && source.id === row.a.id));
  const k = strings.panel.kinds;
  const [title, sub, art] =
    row.kind === 'liked'
      ? [strings.liked.title, `${k.playlist} • ${strings.panel.songs(row.count)}`, null]
      : row.kind === 'playlist'
        ? [
            row.p.name,
            `${k.playlist} • ${row.p.owner ?? strings.panel.songs(row.p.tracks)}`,
            row.p.cover,
          ]
        : row.kind === 'album'
          ? [row.a.title, `${k.album} • ${row.a.artist}`, row.a.cover]
          : [row.name, k.artist, row.cover];
  const body = (
    <>
      {row.kind === 'liked' ? (
        <span className="liked-art" aria-hidden="true">
          <Icon name="heart" className="icon--solid" />
        </span>
      ) : row.kind === 'playlist' && !art ? (
        <span className="art art--list art--empty" aria-hidden="true">
          <Icon name="music" />
        </span>
      ) : (
        <span className={row.kind === 'artist' ? 'round' : undefined}>
          <Artwork size="list" src={art ?? undefined} title={title} />
        </span>
      )}
      <span className="lp-text">
        <span className="lp-name" data-playing={playing || undefined}>
          {title}
        </span>
        <span className="lp-sub">{sub}</span>
      </span>
      {playing && <Icon name="volume" className="lp-speaker" />}
    </>
  );
  return (
    <li className="lp-row">
      {to ? (
        <Link to={to} aria-current={current ? 'page' : undefined}>
          {body}
        </Link>
      ) : (
        <span>{body}</span>
      )}
    </li>
  );
}

const OVERSCAN = 6;

/** The rows near the viewport of the list's own scroller; the rest held by padding. */
function Windowed({ rows, label }: { rows: Row[]; label: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [range, setRange] = useState({ from: 0, to: 40, rowH: 0 });
  useLayoutEffect(() => {
    const ul = ref.current;
    if (!ul) return;
    const measure = () => {
      const rowH = ul.querySelector('li')?.getBoundingClientRect().height ?? 0;
      if (!rowH) return;
      const from = Math.max(0, Math.floor(ul.scrollTop / rowH) - OVERSCAN);
      const to = Math.min(
        rows.length,
        Math.ceil((ul.scrollTop + ul.clientHeight) / rowH) + OVERSCAN,
      );
      setRange((r) => (r.from === from && r.to === to && r.rowH === rowH ? r : { from, to, rowH }));
    };
    measure();
    ul.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(ul);
    return () => {
      ul.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [rows.length]);
  const { from, to, rowH } = range;
  return (
    <ul
      ref={ref}
      className="lp-list"
      aria-label={label}
      style={
        {
          paddingTop: from * rowH,
          paddingBottom: Math.max(0, rows.length - to) * rowH,
        } as CSSProperties
      }
    >
      {rows.slice(from, to).map((row) => (
        <LibraryRow key={row.key} row={row} />
      ))}
    </ul>
  );
}

export function LibraryPanel({ page = false }: { page?: boolean }) {
  const library = useLibrary();
  const navigate = useView((s) => s.navigate);
  const filter = useStore(panels, (s) => s.filter);
  const [q, setQ] = useState('');
  const rows = useRows(filter, q);
  const s = strings.panel;
  const create = async () => {
    const id = await createPlaylist();
    if (id) navigate({ view: 'playlist', id });
  };
  const Heading = page ? 'h1' : 'h2';
  return (
    <nav className={page ? 'library-page' : 'library-panel'} aria-label={strings.nav.library}>
      <header className="lp-head">
        <Heading className="lp-title" tabIndex={page ? -1 : undefined}>
          <Icon name="library" />
          {strings.nav.library}
        </Heading>
        {library?.createPlaylist && (
          <button
            type="button"
            className="round-btn"
            aria-label={s.create}
            title={s.create}
            onClick={create}
          >
            <Icon name="plus" />
          </button>
        )}
      </header>
      <fieldset className="chips">
        <legend className="visually-hidden">{s.filterLabel}</legend>
        {filter !== 'all' && (
          <button
            type="button"
            className="chip chip--clear"
            aria-label={s.clear}
            onClick={() => panels.setState({ filter: 'all' })}
          >
            <Icon name="close" />
          </button>
        )}
        {FILTERS.filter((f) => filter === 'all' || filter === f).map((f) => (
          <button
            key={f}
            type="button"
            className="chip"
            aria-pressed={filter === f}
            onClick={() => panels.setState({ filter: filter === f ? 'all' : f })}
          >
            {s.filters[f]}
          </button>
        ))}
      </fieldset>
      <div className="lp-tools">
        <label className="lp-search">
          <Icon name="search" />
          <span className="visually-hidden">{s.searchIn}</span>
          <input
            type="search"
            value={q}
            placeholder={s.searchIn}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {library?.setSort && <SortSelect />}
      </div>
      {rows.length ? (
        <Windowed rows={rows} label={strings.nav.library} />
      ) : (
        <p className="lp-empty">{s.empty}</p>
      )}
    </nav>
  );
}

function SortSelect() {
  const library = useLibrary();
  const [sort, setSort] = useState<AlbumSort | undefined>(() => library?.sort?.());
  return (
    <label className="lp-sort">
      <span className="visually-hidden">{strings.panel.sortLabel}</span>
      <select
        value={sort}
        onChange={(e) => {
          const next = e.target.value as AlbumSort;
          setSort(next);
          library?.setSort?.(next);
        }}
      >
        {ALBUM_SORTS.map((x) => (
          <option key={x} value={x}>
            {strings.library.sorts[x]}
          </option>
        ))}
      </select>
    </label>
  );
}
