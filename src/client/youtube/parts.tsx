import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import type { Track } from '../../shared/types.ts';
import type { YtItem, YtPage, YtShelf } from '../../shared/youtube.ts';
import { ApiError } from '../api.ts';
import { usePlayback, useQueue } from '../playback/context.tsx';
import { Link, useView } from '../shell/link.tsx';
import { strings } from '../strings.ts';
import { Icon } from '../ui/icons.tsx';
import { BlockError } from '../ui/states.tsx';
import type { Route } from '../view.ts';
import { ytPage, ytSuggest } from './api.ts';
import { playItem } from './play.ts';
import { hintSong } from './radio.ts';

// The pieces YouTube Music mode's pages are made of (yt.css): rows (songs: a tap plays), cards
// (albums, playlists, artists: a tap opens their page), shelves of either, and the search box.

const y = strings.youtube;

/** A page from the server, refetched when its path changes. */
export function useYtPage(path: string) {
  const [state, setState] = useState<{ path: string; page?: YtPage; error?: unknown }>({ path });
  const load = useCallback(() => {
    let live = true;
    setState({ path });
    ytPage(path).then(
      (page) => live && setState({ path, page }),
      (error: unknown) => live && setState({ path, error }),
    );
    return () => {
      live = false;
    };
  }, [path]);
  useEffect(load, [load]);
  return { ...(state.path === path ? state : { path }), retry: load };
}

/** Loading, signed out, failed, or the page. */
export function PageState({
  state,
  children,
}: {
  state: ReturnType<typeof useYtPage>;
  children: (page: YtPage) => ReactNode;
}) {
  if (state.page) return children(state.page);
  if (state.error instanceof ApiError && state.error.code === 'youtube.signed_out')
    return <SignInPrompt message={state.error.userMessage ?? y.signInToSee} />;
  if (state.error) return <BlockError what={y.failed} onRetry={() => state.retry()} />;
  return (
    <div className="yt-loading" aria-busy="true">
      <span className="visually-hidden">{y.loading}</span>
    </div>
  );
}

export function SignInPrompt({ message }: { message: string }) {
  return (
    <div className="yt-signin">
      <p>{message}</p>
      <Link className="yt-button" to={{ view: 'settings', section: 'account' }}>
        {y.signInSettings}
      </Link>
    </div>
  );
}

export function Thumb({ src, round }: { src: string; round?: boolean }) {
  return src ? (
    <img className="yt-thumb" data-round={round || undefined} src={src} alt="" loading="lazy" />
  ) : (
    <span className="yt-thumb yt-thumb--empty" data-round={round || undefined} aria-hidden="true">
      <Icon name="music" />
    </span>
  );
}

export const itemOfTrack = (t: Track): YtItem => ({
  kind: 'song',
  id: t.id,
  title: t.title,
  subtitle: t.artists.map((a) => a.name).join(', '),
  thumb: t.artwork[0]?.url ?? '',
  track: t,
});

const time = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const routeOf = (item: YtItem): Route | null =>
  item.kind === 'album' || item.kind === 'artist' || item.kind === 'playlist'
    ? { view: 'yt', page: { kind: item.kind, id: item.id } }
    : null;

/** A song: a tap plays it (its radio, or the list it is in). */
export function Row({ item, onPlay, index }: { item: YtItem; onPlay: () => void; index?: number }) {
  const playing = useQueue((q) => !!item.track && q.now?.key === item.track.key);
  const label = `${y.play} ${item.title}${item.subtitle ? `, ${item.subtitle}` : ''}`;
  return (
    <li className="yt-row" data-playing={playing || undefined}>
      <button
        type="button"
        className="yt-row-play"
        onClick={onPlay}
        onPointerEnter={() => hintSong(item.id)}
        onFocus={() => hintSong(item.id)}
        aria-label={label}
      >
        {index !== undefined ? (
          <span className="yt-row-index" aria-hidden="true">
            {index + 1}
          </span>
        ) : (
          <Thumb src={item.thumb} />
        )}
        <span className="yt-row-text" aria-hidden="true">
          <span className="yt-row-title">{item.title}</span>
          <span className="yt-row-sub">{item.subtitle}</span>
        </span>
        {item.track && item.track.durationMs > 0 && (
          <span className="yt-row-time" aria-hidden="true">
            {time(item.track.durationMs)}
          </span>
        )}
      </button>
    </li>
  );
}

/** An album, playlist or artist (opens its page), or a song or video (plays its radio). */
export function Card({ item, onPlay }: { item: YtItem; onPlay: () => void }) {
  const to = routeOf(item);
  const body = (
    <>
      <Thumb src={item.thumb} round={item.kind === 'artist'} />
      <span className="yt-card-title">{item.title}</span>
      <span className="yt-card-sub">{item.subtitle}</span>
    </>
  );
  return (
    <li className="yt-card" data-kind={item.kind}>
      {to ? (
        <Link className="yt-card-open" to={to}>
          {body}
        </Link>
      ) : (
        <button
          type="button"
          className="yt-card-open"
          onClick={onPlay}
          onPointerEnter={() => hintSong(item.id)}
          onFocus={() => hintSong(item.id)}
        >
          {body}
        </button>
      )}
    </li>
  );
}

export function Shelf({ shelf }: { shelf: YtShelf }) {
  const c = usePlayback();
  const id = useId();
  return (
    <section className="yt-shelf" aria-labelledby={id}>
      {shelf.strapline && <p className="yt-strap">{shelf.strapline}</p>}
      <h2 id={id}>{shelf.title}</h2>
      {shelf.layout === 'rows' ? (
        <ul className="yt-rows">
          {shelf.items.map((item) => (
            <Row
              key={`${item.kind}:${item.id}`}
              item={item}
              onPlay={() => void playItem(c, item)}
            />
          ))}
        </ul>
      ) : (
        <ul className="yt-cards">
          {shelf.items.map((item) => (
            <Card
              key={`${item.kind}:${item.id}`}
              item={item}
              onPlay={() => void playItem(c, item)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function Shelves({ shelves }: { shelves: YtShelf[] }) {
  // The first song of the page (Quick picks', the top search result) is the likeliest press.
  const first = shelves.find((s) => s.layout === 'rows')?.items[0]?.id;
  useEffect(() => void (first && hintSong(first)), [first]);
  return shelves.map((s) => <Shelf key={s.title} shelf={s} />);
}

/** Search, with YouTube's suggestions as you type (a combobox: arrows move, Enter searches). */
export function YtSearch({ initial }: { initial: string }) {
  const navigate = useView((s) => s.navigate);
  const listId = useId();
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  useEffect(() => setQ(initial), [initial]);
  useEffect(() => {
    if (!open || !q.trim()) return setItems([]);
    let live = true;
    const t = setTimeout(
      () =>
        void ytSuggest(q.trim()).then(
          (s) => live && setItems(s),
          () => live && setItems([]),
        ),
      150,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open]);
  const shown = open && items.length > 0;

  const go = (text: string) => {
    const v = text.trim();
    if (!v) return;
    setOpen(false);
    setQ(v);
    navigate({ view: 'yt', page: { kind: 'search', q: v, tab: 'all' } });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') return setOpen(false);
    if (!shown || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    // -1 is the typed text itself; past either end wraps around to it.
    setActive((a) => {
      const n = a + step;
      return n >= items.length ? -1 : n < -1 ? items.length - 1 : n;
    });
  };

  return (
    <search className="yt-search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(shown && active >= 0 && active < items.length ? (items[active] ?? q) : q);
        }}
      >
        <Icon name="search" />
        <input
          type="search"
          role="combobox"
          aria-label={y.search}
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={y.searchPlaceholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKey}
          onBlur={() => setOpen(false)}
        />
        <div
          id={listId}
          role="listbox"
          aria-label={y.suggestions}
          className="yt-suggest"
          hidden={!shown}
        >
          {items.map((s, i) => (
            <div
              key={s}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // before the input's blur closes the list
                go(s);
              }}
            >
              {s}
            </div>
          ))}
        </div>
      </form>
    </search>
  );
}
