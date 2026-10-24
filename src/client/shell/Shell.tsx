import { lazy, Suspense, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { Library } from '../library.ts';
import { PlaybackContext, usePlayer } from '../playback/context.tsx';
import type { PlaybackController } from '../playback/controller.ts';
import { sessionStore } from '../session.ts';
import { stageChrome } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { buttonClass } from '../ui/controls.tsx';
import { ToastRegion } from '../ui/overlays.tsx';
import {
  LIBRARY_TABS,
  type Route,
  SETTINGS_SECTIONS,
  type SettingsSection,
  type ViewStore,
} from '../view.ts';
import { InviteView } from './AccountViews.tsx';
import { AdminSection } from './AdminViews.tsx';
import { AccountSection, LoginView, SessionExpiredSheet, SetupView } from './AuthViews.tsx';
import { useChromeIdle } from './chrome.ts';
import { Dock } from './Dock.tsx';
import { AlbumView, LibraryContent, SearchResults } from './LibraryViews.tsx';
import { Link, useView, ViewContext } from './link.tsx';
import { ReplaceQueueDialog } from './ReplaceQueue.tsx';
import { PreferencesSection } from './SettingsViews.tsx';
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
  login: strings.auth.signIn,
  setup: strings.auth.setupTitle,
  invite: strings.account.inviteTitle,
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

  // Signing in and setting up stand alone: no sidebar, no player.
  if (route.view === 'login' || route.view === 'setup' || route.view === 'invite')
    return (
      <main className="auth-page" ref={main}>
        <View route={route} />
      </main>
    );

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
      <ReplaceQueueDialog />
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
