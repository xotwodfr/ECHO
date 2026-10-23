import {
  type AnchorHTMLAttributes,
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { useStore } from 'zustand';
import { strings } from '../strings.ts';
import {
  LIBRARY_TABS,
  type Route,
  routePath,
  SETTINGS_SECTIONS,
  type ViewState,
  type ViewStore,
} from '../view.ts';

// The shell frame (DESIGN_SYSTEM.md §5): sidebar + canvas + dock, or the full-bleed Stage on Listen.

const ViewContext = createContext<ViewStore | null>(null);

function useView<T>(select: (s: ViewState) => T): T {
  const store = useContext(ViewContext);
  if (!store) throw new Error('useView outside <Shell>');
  return useStore(store, select);
}

/** A real `<a href>` (open in new tab and copy link work); plain left clicks navigate in place. */
function Link({ to, ...rest }: { to: Route } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigate = useView((s) => s.navigate);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={routePath(to)} onClick={onClick} {...rest} />;
}

const isTextField = (el: Element | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && el.isContentEditable);

function SearchField({ className }: { className: string }) {
  const route = useView((s) => s.route);
  const navigate = useView((s) => s.navigate);
  const q = route.view === 'search' ? route.q : '';
  return (
    <label className={`search-field ${className}`}>
      <span className="visually-hidden">{strings.nav.search}</span>
      <input
        type="search"
        value={q}
        placeholder={strings.search.placeholder}
        // Typing refines one history entry instead of adding one per keystroke.
        onChange={(e) =>
          navigate({ view: 'search', q: e.target.value }, { replace: route.view === 'search' })
        }
      />
      <span className="hint" aria-hidden="true">
        /
      </span>
    </label>
  );
}

function Sidebar({ route }: { route: Route }) {
  const current = (view: Route['view'][]) =>
    view.includes(route.view) ? ('page' as const) : undefined;
  return (
    <nav className="sidebar" aria-label={strings.nav.label}>
      <p className="wordmark">{strings.app}</p>
      <ul>
        <li>
          <Link to={{ view: 'listen' }} aria-current={current(['listen'])}>
            {strings.nav.listen}
          </Link>
        </li>
        <li>
          <Link
            to={{ view: 'library', tab: 'albums' }}
            aria-current={current(['library', 'album'])}
          >
            {strings.nav.library}
          </Link>
        </li>
        <li>
          <SearchField className="search-wide" />
          <Link
            className="search-compact"
            to={{ view: 'search', q: '' }}
            aria-current={current(['search'])}
          >
            {strings.nav.search}
          </Link>
        </li>
        <li>
          <Link
            to={{ view: 'settings', section: 'preferences' }}
            aria-current={current(['settings'])}
          >
            {strings.nav.settings}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

function Tabs<T extends string>(props: {
  label: string;
  items: readonly T[];
  names: Record<T, string>;
  current: T;
  to: (item: T) => Route;
}) {
  return (
    <nav className="tabs" aria-label={props.label}>
      {props.items.map((item) => (
        <Link
          key={item}
          to={props.to(item)}
          aria-current={item === props.current ? 'page' : undefined}
        >
          {props.names[item]}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Album grid (DESIGN_SYSTEM.md §5). W is the canvas content width: the window minus the 224px
 * sidebar minus the two 32px gutters. Tiles are at least 168px with the one 16px gap, so
 *
 *   columns = floor((W + 16) / (168 + 16))
 *
 * (n tiles need n·168 + (n − 1)·16 ≤ W). CSS `repeat(auto-fill, minmax(168px, 1fr))` computes exactly
 * this count, and `1fr` stretches the tiles over the remainder, so the first tile starts on the left
 * gutter and the last one ends on the right gutter. Example, 1440 wide: W = 1440 − 224 − 64 = 1152,
 * floor(1168 / 184) = 6 columns of (1152 − 5·16) / 6 = 178.67px.
 */
function AlbumGrid({ children }: { children?: ReactNode }) {
  return <ul className="album-grid">{children}</ul>;
}

function View({ route }: { route: Route }) {
  switch (route.view) {
    case 'listen':
      return (
        <div className="stage">
          <h1 className="visually-hidden" tabIndex={-1}>
            {strings.nav.listen}
          </h1>
          <div className="stage-chrome">
            <Link className="tertiary" to={{ view: 'library', tab: 'albums' }}>
              {strings.nav.library}
            </Link>
          </div>
        </div>
      );
    case 'library':
      return (
        <>
          <h1 tabIndex={-1}>{strings.nav.library}</h1>
          <Tabs
            label={strings.library.tabsLabel}
            items={LIBRARY_TABS}
            names={strings.library.tabs}
            current={route.tab}
            to={(tab) => ({ view: 'library', tab })}
          />
          <p className="empty">{strings.library.empty}</p>
          {route.tab === 'albums' && <AlbumGrid />}
        </>
      );
    case 'album':
      return (
        <>
          <h1 tabIndex={-1}>{strings.album.title}</h1>
          <p className="empty">{strings.album.missing}</p>
        </>
      );
    case 'search':
      return (
        <>
          <h1 tabIndex={-1}>{strings.nav.search}</h1>
          <SearchField className="search-compact" />
          <p className="empty">{route.q ? strings.search.none(route.q) : strings.search.prompt}</p>
        </>
      );
    case 'settings':
      return (
        <>
          <h1 tabIndex={-1}>{strings.nav.settings}</h1>
          <Tabs
            label={strings.settings.sectionsLabel}
            items={SETTINGS_SECTIONS}
            names={strings.settings.sections}
            current={route.section}
            to={(section) => ({ view: 'settings', section })}
          />
          <h2>{strings.settings.sections[route.section]}</h2>
          <p className="empty">{strings.settings.empty}</p>
        </>
      );
    case 'notFound':
      return (
        <>
          <h1 tabIndex={-1}>{strings.notFound.title}</h1>
          <p className="empty">{strings.notFound.body}</p>
          <Link className="tertiary" to={{ view: 'library', tab: 'albums' }}>
            {strings.nav.library}
          </Link>
        </>
      );
  }
}

const TITLES: Record<Route['view'], string> = {
  listen: strings.nav.listen,
  library: strings.nav.library,
  album: strings.album.title,
  search: strings.nav.search,
  settings: strings.nav.settings,
  notFound: strings.notFound.title,
};

function Frame() {
  const route = useView((s) => s.route);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    document.title = `${TITLES[route.view]} · ${strings.app}`;
    if (first.current) {
      first.current = false;
      return;
    }
    // After a navigation, move focus to the new view's heading so keyboard and screen-reader users
    // start there. Not while typing in the search field, which navigates on every keystroke.
    if (!isTextField(document.activeElement)) main.current?.querySelector('h1')?.focus();
    main.current?.scrollTo(0, 0);
  }, [route]);

  useEffect(() => {
    // `/` focuses the visible search field (the hint shown in it).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target as Element))
        return;
      const field = [...document.querySelectorAll<HTMLInputElement>('input[type="search"]')].find(
        (el) => el.offsetParent !== null,
      );
      if (!field) return;
      e.preventDefault();
      field.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell" data-view={route.view}>
      {route.view !== 'listen' && <Sidebar route={route} />}
      <main className="canvas" ref={main}>
        <View route={route} />
      </main>
      <section className="dock" aria-label={strings.dock.label}>
        <p className="dock-idle">{strings.dock.idle}</p>
      </section>
    </div>
  );
}

export function Shell({ store }: { store: ViewStore }) {
  return (
    <ViewContext.Provider value={store}>
      <Frame />
    </ViewContext.Provider>
  );
}
