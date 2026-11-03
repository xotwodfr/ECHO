import { lazy, Suspense, type UIEvent, useCallback, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { Library } from '../library.ts';
import { PlaybackContext, usePlayer } from '../playback/context.tsx';
import type { PlaybackController } from '../playback/controller.ts';
import { sessionStore } from '../session.ts';
import { stageChrome } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { buttonClass } from '../ui/controls.tsx';
import { Icon } from '../ui/icons.tsx';
import { useSlide } from '../ui/motion.ts';
import { ToastRegion } from '../ui/overlays.tsx';
import {
  LIBRARY_TABS,
  type LibraryTab,
  type Route,
  routePath,
  SETTINGS_SECTIONS,
  type SettingsSection,
  type ViewStore,
} from '../view.ts';
import { AccountMenu } from './AccountMenu.tsx';
import { InviteView } from './AccountViews.tsx';
import { AdminSection } from './AdminViews.tsx';
import { AccountSection, LoginView, SessionExpiredSheet, SetupView } from './AuthViews.tsx';
import { useChromeIdle } from './chrome.ts';
import { useCompact } from './compact.ts';
import { Dock } from './Dock.tsx';
import { HomeView } from './HomeView.tsx';
import { LibraryPanel } from './LibraryPanel.tsx';
import {
  AlbumView,
  ArtistView,
  GenreView,
  LibraryContent,
  LikedView,
  PlaylistView,
  SearchResults,
} from './LibraryViews.tsx';
import { Link, useView, ViewContext } from './link.tsx';
import { Mica } from './Mica.tsx';
import { MixView, WrappedView } from './MixViews.tsx';
import { PlaylistPicker } from './PlaylistPicker.tsx';
import { panels } from './panels.ts';
import { RightPanel } from './RightPanel.tsx';
import { PreferencesSection } from './SettingsViews.tsx';
import { Stage } from './Stage.tsx';
import { StageChrome, StageContent } from './StageViews.tsx';

// The frame (DESIGN_SYSTEM.md §5), after Spotify's: a top bar, Your Library on the left, the page
// in the middle, Now Playing or the queue on the right, and the player floating over the page as
// a pill. Phones: the page, a mini player and the navigation bar. The lyrics view (Listen)
// fills the window, the pill floating over it.

// The component gallery (DESIGN_SYSTEM.md §9, DS-06) is a development page:
// compiled out of the production image (ECHO_DEV_PAGES=0), where /__ui is "Page not found".
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
      <Icon name="search" />
      <span className="visually-hidden">{strings.nav.search}</span>
      <input
        type="search"
        value={q}
        placeholder={strings.search.placeholder}
        // Spotify opens Browse on the first click into the box.
        onFocus={() => route.view !== 'search' && navigate({ view: 'search', q: '' })}
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

/** Top bar (§5): the wordmark, Home, the search pill, and the account menu. */
function TopBar({ route }: { route: Route }) {
  const home = route.view === 'home';
  return (
    <header className="topbar">
      <Link className="wordmark" to={{ view: 'home' }}>
        {strings.app}
      </Link>
      <nav className="topbar-nav" aria-label={strings.nav.label}>
        <Link
          className="round-btn round-btn--lg"
          to={{ view: 'home' }}
          aria-label={strings.nav.home}
          title={strings.nav.home}
          aria-current={home ? 'page' : undefined}
        >
          <Icon name="home" solid={home} />
        </Link>
        <SearchField className="topbar-search" />
      </nav>
      <AccountMenu />
    </header>
  );
}

/** Phones (§5): Home, Search and Your Library as an M3 navigation bar at the bottom. */
function TabBar({ route }: { route: Route }) {
  const tab = (
    to: Route,
    views: Route['view'][],
    icon: 'home' | 'search' | 'library',
    label: string,
  ) => {
    const on = views.includes(route.view);
    return (
      <li>
        <Link to={to} aria-current={on ? 'page' : undefined}>
          <Icon name={icon} solid={on} />
          <span>{label}</span>
        </Link>
      </li>
    );
  };
  const nav = useRef<HTMLElement>(null);
  useSlide(nav, 'a[aria-current="page"]', route.view, '::after');
  return (
    <nav className="tabbar" aria-label={strings.nav.label} ref={nav}>
      <ul>
        {tab({ view: 'home' }, ['home', 'mix', 'wrapped'], 'home', strings.nav.home)}
        {tab({ view: 'search', q: '' }, ['search', 'genre'], 'search', strings.nav.search)}
        {tab(
          { view: 'library', tab: 'albums' },
          ['library', 'album', 'artist', 'playlist', 'liked'],
          'library',
          strings.nav.library,
        )}
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
 * Your Library as a page: on phones the list (Spotify's app), on wide screens Spotify's expanded
 * view: chips for the kinds, the album order, and a grid of covers.
 */
function LibraryPage({ tab }: { tab: LibraryTab }) {
  const compact = useCompact();
  if (compact) return <LibraryPanel page />;
  return (
    <div className="library-grid-page">
      <h1 tabIndex={-1}>{strings.nav.library}</h1>
      <Tabs
        label={strings.library.tabsLabel}
        items={LIBRARY_TABS}
        names={strings.library.tabs}
        current={tab}
        to={(t) => ({ view: 'library', tab: t })}
      />
      <LibraryContent tab={tab} />
    </div>
  );
}

/** Settings: Preferences, Account and, for admins, Admin (SETTINGS_AND_SECURITY.md §7.3). */
function SettingsView({ section }: { section: SettingsSection }) {
  const session = useStore(sessionStore);
  const admin = session.status === 'signedIn' && session.role === 'admin';
  const sections = SETTINGS_SECTIONS.filter((x) => x !== 'admin' || admin);
  return (
    <>
      <h1 tabIndex={-1}>{strings.nav.settings}</h1>
      <Tabs
        label={strings.settings.sectionsLabel}
        items={sections}
        names={strings.settings.sections}
        current={section}
        to={(s) => ({ view: 'settings', section: s })}
      />
      <h2>{strings.settings.sections[section]}</h2>
      {section === 'account' ? (
        <AccountSection />
      ) : section === 'admin' ? (
        admin ? (
          <AdminSection />
        ) : (
          <p className="empty">{strings.settings.adminOnly}</p>
        )
      ) : (
        <PreferencesSection />
      )}
    </>
  );
}

function View({ route }: { route: Route }) {
  switch (route.view) {
    case 'home':
      return <HomeView />;
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
      return <LibraryPage tab={route.tab} />;
    case 'album':
      return <AlbumView id={route.id} />;
    case 'artist':
      return <ArtistView id={route.id} />;
    case 'playlist':
      return <PlaylistView id={route.id} />;
    case 'liked':
      return <LikedView />;
    case 'genre':
      return <GenreView name={route.name} />;
    case 'mix':
      return <MixView id={route.id} />;
    case 'wrapped':
      return <WrappedView year={route.year} />;
    case 'search':
      return (
        <>
          <h1 className="visually-hidden" tabIndex={-1}>
            {strings.nav.search}
          </h1>
          <SearchField className="search-compact" />
          <SearchResults q={route.q} />
        </>
      );
    case 'settings':
      return <SettingsView section={route.section} />;
    case 'login':
      return <LoginView />;
    case 'setup':
      return <SetupView />;
    case 'invite':
      return <InviteView />;
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
          <Link className={buttonClass('secondary')} to={{ view: 'home' }}>
            {strings.nav.home}
          </Link>
        </>
      );
  }
}

const TITLES: Record<Route['view'], string> = {
  home: strings.nav.home,
  listen: strings.nav.listen,
  library: strings.nav.library,
  album: strings.album.title,
  artist: strings.artist.title,
  playlist: strings.playlist.title,
  liked: strings.liked.title,
  genre: strings.genre.title,
  mix: strings.mix.madeForYou,
  wrapped: strings.wrapped.title,
  search: strings.nav.search,
  settings: strings.nav.settings,
  ui: strings.gallery.title,
  login: strings.auth.signIn,
  setup: strings.auth.setupTitle,
  invite: strings.account.inviteTitle,
  notFound: strings.notFound.title,
};

function Frame() {
  const route = useView((s) => s.route);
  const navigate = useView((s) => s.navigate);
  const playing = usePlayer((p) => p.status === 'playing');
  const chromeHidden = useStore(stageChrome, (s) => s.hidden);
  const right = useStore(panels, (s) => s.right);
  useChromeIdle(route.view === 'listen' && playing);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  const back = useView((s) => s.back);
  // Where each page was left, by its address, kept as it scrolls.
  const scrolls = useRef(new Map<string, number>());
  const onScroll = useCallback(
    (e: UIEvent<HTMLElement>) => scrolls.current.set(routePath(route), e.currentTarget.scrollTop),
    [route],
  );

  useEffect(() => {
    document.title = `${TITLES[route.view]} · ${strings.app}`;
    if (first.current) {
      first.current = false;
      return;
    }
    // After a navigation, move focus to the new view's heading so keyboard and screen-reader users
    // start there. Not while typing in the search field, which navigates on every keystroke.
    if (!isTextField(document.activeElement))
      main.current?.querySelector('h1')?.focus({ preventScroll: true });
    // A new page starts at its top; Back returns to where it was left (its content is cached,
    // fresh.ts, so it is there to scroll to; once more a moment later for what was not).
    const el = main.current;
    const to = back ? (scrolls.current.get(routePath(route)) ?? 0) : 0;
    el?.scrollTo(0, to);
    if (!to) return;
    const again = setTimeout(() => el?.scrollTo(0, to), 400);
    return () => clearTimeout(again);
  }, [route, back]);

  useEffect(() => {
    // A right-click opens the item's own menu (Spotify's): a song's, a card's, a row of Your
    // Library's. Shift+right-click keeps the browser's (open in a new tab, copy link).
    const onMenu = (e: MouseEvent) => {
      if (e.shiftKey || !(e.target instanceof Element)) return;
      const item = e.target.closest('.track-row, .tile, .lp-row');
      const trigger = item?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
      if (!trigger) return;
      e.preventDefault();
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    };
    document.addEventListener('contextmenu', onMenu);
    return () => document.removeEventListener('contextmenu', onMenu);
  }, []);

  useEffect(() => {
    // `/` or Ctrl/⌘+K focuses the visible search field (the hint shown in it); where none is
    // visible (the lyrics view), it opens Search.
    const onKey = (e: KeyboardEvent) => {
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
      const k = e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey;
      if (!(slash || k) || (slash && isTextField(e.target as Element))) return;
      e.preventDefault();
      const visible = () =>
        [...document.querySelectorAll<HTMLInputElement>('.search-field input[type="search"]')].find(
          (el) => el.offsetParent !== null,
        );
      const field = visible();
      if (field) return field.focus();
      navigate({ view: 'search', q: '' });
      requestAnimationFrame(() => visible()?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Signing in and setting up stand alone: no panels, no player.
  if (route.view === 'login' || route.view === 'setup' || route.view === 'invite')
    return (
      <main className="auth-page" ref={main}>
        <View route={route} />
      </main>
    );

  const listen = route.view === 'listen';
  return (
    <div
      className="shell"
      data-view={route.view}
      data-right={!listen && right ? right : undefined}
      data-chrome={listen && chromeHidden ? 'hidden' : undefined}
    >
      <Mica />
      {!listen && <TopBar route={route} />}
      {!listen && <LibraryPanel />}
      <main className="canvas" ref={main} onScroll={onScroll}>
        <View route={route} />
      </main>
      {!listen && <RightPanel />}
      <Dock stage={listen} />
      {!listen && <TabBar route={route} />}
      <ToastRegion />
      <PlaylistPicker />
      <SessionExpiredSheet />
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
