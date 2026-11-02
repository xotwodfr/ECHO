import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link } from '../shell/link.tsx';
import { strings } from '../strings.ts';
import type { Route } from '../view.ts';
import type { Force } from './controls.tsx';
import { Icon } from './icons.tsx';
import { formatTime } from './logic.ts';
import { noteLoading, useArrival } from './motion.ts';
import { Menu, type MenuItem } from './overlays.tsx';

// Artwork, track rows and album tiles (DESIGN_SYSTEM.md §8, §9.3, §9.4).

type ArtSize = 'row' | 'list' | 'dock' | 'grid' | 'detail' | 'cover' | 'np' | 'shortcut';

/**
 * Cover art (§8): never cropped or animated; 4px radius, 6px on cards. Missing art is a raised
 * square with the album title, no icon. Decorative: the title is always next to it.
 */
export function Artwork({ src, title, size }: { src?: string; title: string; size: ArtSize }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`art art--${size}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        // The title is generated content: the square is a picture, so its text stays out of
        // find-in-page, selection and text measurement.
        <span className="art-fallback" data-title={title} aria-hidden="true" />
      )}
    </span>
  );
}

/** The animated 3-bar now-playing glyph (static under reduced motion). */
function NowPlayingBars() {
  return (
    <span className="np-bars" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export interface TrackRowProps {
  number?: number;
  title: string;
  artist: string;
  durationMs: number;
  /** A media row (64px) with a 40px cover and the artist as a subline. */
  artwork?: { src?: string; album: string };
  selected?: boolean;
  nowPlaying?: boolean;
  /** The decay trace (§2.3): only on the most recently played row of a list. */
  decay?: { durationMs: number; elapsedMs: number; paused?: boolean };
  onPlay: () => void;
  menu?: MenuItem[];
  /** The heart (hearts.tsx), before the duration. */
  heart?: ReactNode;
  force?: Force;
  /** Extra attributes on the row: keyboard and drag handling where a list can be reordered. */
  rowProps?: HTMLAttributes<HTMLLIElement>;
  /** Who the row is across reorders, for the queue's glide (useFlip, ui/motion.ts). */
  flipKey?: string;
}

/** Track row (§9.3): the whole row plays; numbers right-aligned and tabular. */
export function TrackRow(p: TrackRowProps) {
  return (
    <li
      className="track-row"
      data-media={p.artwork ? true : undefined}
      data-selected={p.selected || undefined}
      data-now-playing={p.nowPlaying || undefined}
      data-force={p.force}
      aria-current={p.nowPlaying || undefined}
      data-flip-key={p.flipKey}
      {...p.rowProps}
    >
      {p.number !== undefined && (
        <span className="track-num num">
          {/* Spotify's row: the number gives way to a play glyph on hover, bars while playing. */}
          {p.nowPlaying ? <NowPlayingBars /> : <span className="track-num-n">{p.number}</span>}
          <Icon name="play" className="track-num-play" solid />
        </span>
      )}
      {p.artwork && <Artwork size="row" src={p.artwork.src} title={p.artwork.album} />}
      <button
        type="button"
        className="track-main"
        aria-label={strings.ui.playItem(p.title)}
        onClick={p.onPlay}
      >
        <span className="track-title">
          {p.nowPlaying && p.number === undefined && <NowPlayingBars />}
          {p.title}
        </span>
        {p.artwork && <span className="track-sub">{p.artist}</span>}
      </button>
      {p.nowPlaying && <span className="visually-hidden">{strings.ui.nowPlaying}</span>}
      {p.heart && <span className="track-heart">{p.heart}</span>}
      <span className="track-dur num">{formatTime(p.durationMs)}</span>
      {p.menu && <Menu label={strings.ui.moreFor(p.title)} items={p.menu} />}
      {p.decay && (
        <span
          className="decay-trace"
          aria-hidden="true"
          data-paused={p.decay.paused || undefined}
          style={
            {
              '--trace-ms': `${p.decay.durationMs}ms`,
              '--trace-at': `${-p.decay.elapsedMs}ms`,
            } as CSSProperties
          }
        />
      )}
    </li>
  );
}

/** Loading row: the final layout with flat bars at the real sizes, no shimmer (§10). */
export function TrackRowSkeleton({ media = false }: { media?: boolean }) {
  useEffect(noteLoading, []);
  return (
    <li className="track-row track-row--loading" data-media={media || undefined} aria-hidden="true">
      {media && <span className="art art--row" />}
      <span className="track-main">
        <span className="bar bar--body" />
        {media && <span className="bar bar--small" />}
      </span>
      <span className="bar bar--small bar--num" />
    </li>
  );
}

/** A list of track rows. `ruled`: the Detail table, rules between rows and a header (§9.3). */
export function TrackList({
  label,
  ruled = false,
  busy = false,
  children,
}: {
  label: string;
  ruled?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLOListElement>(null);
  useArrival(ref);
  return (
    <div className="track-list" data-ruled={ruled || undefined}>
      {ruled && (
        <div className="track-head" aria-hidden="true">
          <span className="track-num">#</span>
          <span>{strings.ui.title}</span>
          <span className="track-dur">{strings.ui.duration}</span>
        </div>
      )}
      <ol ref={ref} aria-label={label} aria-busy={busy || undefined}>
        {children}
      </ol>
    </div>
  );
}

/**
 * Card (§9.4), Spotify's: the cover, the title and a subtitle on a surround that lights on hover;
 * the whole card opens its page. The green play button rises onto the cover's corner on hover and
 * on keyboard focus. Artists' pictures are round.
 */
export function AlbumTile(p: {
  id: string;
  title: string;
  artist: string;
  cover?: string;
  onPlay?: () => void;
  /** Where the card leads; an album by default. */
  to?: Route;
  round?: boolean;
  force?: Force;
  /** A picture made for the card instead of a cover (Made For You's mixes). */
  art?: ReactNode;
  /** The card's own menu: its ⋯ on hover or focus, and a right-click (Shell.tsx). */
  menu?: MenuItem[];
}) {
  return (
    <li
      className="tile"
      data-force={p.force}
      data-round={p.round || undefined}
      // Spotify's own covers carry nothing over them (DESIGN_SYSTEM.md §8).
      data-provider={p.id.startsWith('spotify:') ? 'spotify' : undefined}
    >
      <span className="tile-cover">
        {p.art ?? <Artwork size="grid" src={p.cover} title={p.title} />}
        {p.onPlay && (
          <button
            type="button"
            className="tile-play"
            aria-label={strings.ui.playItem(p.title)}
            onClick={p.onPlay}
          >
            <Icon name="play" solid />
          </button>
        )}
      </span>
      <Link className="tile-link" to={p.to ?? { view: 'album', id: p.id }}>
        <span className="tile-title">{p.title}</span>
      </Link>
      {p.menu && (
        <span className="tile-menu">
          <Menu label={strings.ui.moreFor(p.title)} items={p.menu} />
        </span>
      )}
      <span className="tile-artist">{p.artist}</span>
    </li>
  );
}

export function AlbumTileSkeleton() {
  useEffect(noteLoading, []);
  return (
    <li className="tile tile--loading" aria-hidden="true">
      <span className="art art--grid" />
      <span className="bar bar--body" />
      <span className="bar bar--small" />
    </li>
  );
}

/**
 * Album grid (DESIGN_SYSTEM.md §5). W is the canvas content width: the window minus the 224px
 * sidebar (--sidebar) minus the two 32px gutters (--gutter). Tiles are at least 168px (--tile-min),
 * with the one 16px gap (--gap), so
 *
 *   columns = floor((W + 16) / (168 + 16))
 *
 * (n tiles need n·168 + (n − 1)·16 ≤ W). CSS `repeat(auto-fill, minmax(168px, 1fr))` computes exactly
 * this count, and `1fr` stretches the tiles over the remainder, so the first tile starts on the left
 * gutter and the last one ends on the right gutter. Example, 1440 wide: W = 1440 − 224 − 64 = 1152,
 * floor(1168 / 184) = 6 columns of (1152 − 5·16) / 6 = 178.67px.
 */
export function AlbumGrid({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  useArrival(ref);
  return (
    <ul ref={ref} className="album-grid" aria-label={strings.search.albums}>
      {children}
    </ul>
  );
}

/** Lists longer than this are windowed (LIB-02: ≤ 150 tiles in the DOM at 5,000 albums). */
export const WINDOW_FROM = 150;
const OVERSCAN_ROWS = 2;

/**
 * The album grid for long lists: the same CSS grid, but only the rows near the viewport are in the
 * DOM, with the rows above and below held by padding. Columns and row height are read from the
 * rendered grid, so the arithmetic above stays CSS's.
 */
export function WindowedAlbumGrid<T>({
  items,
  render,
}: {
  items: readonly T[];
  render: (item: T) => ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  useArrival(ref);
  const [range, setRange] = useState({ from: 0, to: 60, cols: 6, rowH: 0 });
  useLayoutEffect(() => {
    const ul = ref.current;
    const scroller = ul?.closest<HTMLElement>('.canvas') ?? null;
    if (!ul || !scroller) return;
    const measure = () => {
      const cols = Math.max(1, getComputedStyle(ul).gridTemplateColumns.split(' ').length);
      const first = ul.querySelector('li');
      const gap = Number.parseFloat(getComputedStyle(ul).rowGap) || 0;
      const rowH = first ? first.getBoundingClientRect().height + gap : 0;
      if (!rowH) return;
      const top = ul.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const view = scroller.clientHeight;
      const startRow = Math.max(0, Math.floor(-top / rowH) - OVERSCAN_ROWS);
      const endRow = Math.ceil((view - top) / rowH) + OVERSCAN_ROWS;
      const from = startRow * cols;
      const to = Math.min(items.length, endRow * cols);
      setRange((r) =>
        r.from === from && r.to === to && r.cols === cols && r.rowH === rowH
          ? r
          : { from, to, cols, rowH },
      );
    };
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [items.length]);
  const rows = Math.ceil(items.length / range.cols);
  const before = Math.floor(range.from / range.cols) * range.rowH;
  const after = Math.max(0, rows - Math.ceil(range.to / range.cols)) * range.rowH;
  return (
    <ul
      ref={ref}
      className="album-grid"
      aria-label={strings.search.albums}
      style={{ paddingTop: before, paddingBottom: after } as CSSProperties}
    >
      {items.slice(range.from, range.to).map(render)}
    </ul>
  );
}
