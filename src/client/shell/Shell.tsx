import { lazy, Suspense, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { Library } from '../library.ts';
import { PlaybackContext, usePlayer } from '../playback/context.tsx';
import type { PlaybackController } from '../playback/controller.ts';
import { stageChrome, webgl2Supported } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { buttonClass, Pill } from '../ui/controls.tsx';
import { ToastRegion } from '../ui/overlays.tsx';
import { LIBRARY_TABS, type Route, SETTINGS_SECTIONS, type ViewStore } from '../view.ts';
import { useChromeIdle } from './chrome.ts';
import { Dock } from './Dock.tsx';
import { AlbumView, LibraryContent, SearchResults } from './LibraryViews.tsx';
import { Link, useView, ViewContext } from './link.tsx';
import { Stage } from './Stage.tsx';
import { StageChrome, StageContent } from './StageViews.tsx';

// The shell frame (DESIGN_SYSTEM.md §5): sidebar + canvas + dock, or the full-bleed Stage on Listen.

// The component gallery (DESIGN_SYSTEM.md §9, DS-06) is a development page like the type specimen:
// compiled out of the production image (ECHO_SPECIMEN=0), where /__ui is "Page not found".
const Gallery = __ECHO_UI_PAGE__ ? lazy(() => import('./Gallery.tsx')) : null;

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

function View({ route }: { route: Route }) {
  switch (route.view) {
    case 'listen':
      return (
        <Stage frame={route.frame}>
          <h1 className="visually-hidden" tabIndex={-1}>
            {strings.nav.listen}
          </h1>
          <StageChrome />
          <StageContent />
        </Stage>
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
          <LibraryContent tab={route.tab} />
        </>
      );
    case 'album':
      return <AlbumView id={route.id} />;
    case 'search':
      return (
        <>
          <h1 tabIndex={-1}>{strings.nav.search}</h1>
          <SearchField className="search-compact" />
          <SearchResults q={route.q} />
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
          {route.section === 'preferences' && !webgl2Supported() ? (
            <p className="notice">
              <Pill tone="warn">{strings.settings.visualsLimitedPill}</Pill>
              {strings.settings.visualsLimited}
            </p>
          ) : (
            <p className="empty">{strings.settings.empty}</p>
          )}
        </>
      );
    case 'ui':
      if (Gallery)
        return (
          <Suspense>
            <Gallery />
          </Suspense>
        );
      return <View route={{ view: 'notFound', path: '/__ui' }} />;
    case 'notFound':
      return (
        <>
          <h1 tabIndex={-1}>{strings.notFound.title}</h1>
          <p className="empty">{strings.notFound.body}</p>
          <Link className={buttonClass('tertiary')} to={{ view: 'library', tab: 'albums' }}>
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
  ui: strings.gallery.title,
  notFound: strings.notFound.title,
};

function Frame() {
  const route = useView((s) => s.route);
  const playing = usePlayer((p) => p.status === 'playing');
  // Spotify's artwork and metadata must stay visible while it plays (DESIGN_SYSTEM.md §8).
  const attribution = usePlayer((p) => p.capabilities.requiresAttribution === 'spotify');
  const chromeHidden = useStore(stageChrome, (s) => s.hidden);
  useChromeIdle(route.view === 'listen' && playing);
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
    <div
      className="shell"
      data-view={route.view}
      data-chrome={route.view === 'listen' && chromeHidden ? 'hidden' : undefined}
      data-attribution={attribution || undefined}
    >
      {route.view !== 'listen' && <Sidebar route={route} />}
      <main className="canvas" ref={main}>
        <View route={route} />
      </main>
      <Dock stage={route.view === 'listen'} />
      <ToastRegion />
    </div>
  );
}

export function Shell(props: {
  store: ViewStore;
  controller: PlaybackController;
  library: Library | null;
}) {
  return (
    <ViewContext.Provider value={props.store}>
      <PlaybackContext.Provider value={{ controller: props.controller, library: props.library }}>
        <Frame />
      </PlaybackContext.Provider>
    </ViewContext.Provider>
  );
}
