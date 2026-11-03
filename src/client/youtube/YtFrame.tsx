import { useCallback, useEffect, useRef, useState } from 'react';
import './yt.css';
import { AccountMenu } from '../shell/AccountMenu.tsx';
import { SessionExpiredSheet } from '../shell/AuthViews.tsx';
import { useCompact } from '../shell/compact.ts';
import { Link } from '../shell/link.tsx';
import { strings } from '../strings.ts';
import { Icon, type IconName } from '../ui/icons.tsx';
import { ToastRegion } from '../ui/overlays.tsx';
import type { Route, YtRoute } from '../view.ts';
import { useYtShortcuts } from './keys.ts';
import { ModeSwitch } from './ModeSwitch.tsx';
import { NowPlaying, type Tab } from './NowPlaying.tsx';
import { PlayerBar } from './PlayerBar.tsx';
import { YtPageView } from './pages.tsx';
import { YtSearch } from './parts.tsx';

// YouTube Music mode's frame, "Liner notes" (board C of the Liner notes spec): a masthead (ECHO, the
// edition, search, the switch, the account), the tabs under it (at the bottom on phones), the page,
// and the ink strip.
// Only what is drawn differs from Navidrome mode: the player and queue underneath are the same.

const y = strings.youtube;
const NAV: { kind: 'home' | 'explore' | 'library'; icon: IconName }[] = [
  { kind: 'home', icon: 'home' },
  { kind: 'explore', icon: 'radio' },
  { kind: 'library', icon: 'library' },
];

function Nav({ page, className, icons }: { page: YtRoute; className: string; icons: boolean }) {
  return (
    <nav className={className} aria-label={y.name}>
      {NAV.map((n) => (
        <Link
          key={n.kind}
          className="yt-nav-link"
          to={{ view: 'yt', page: { kind: n.kind } }}
          aria-current={page.kind === n.kind ? 'page' : undefined}
        >
          {icons && <Icon name={n.icon} solid={page.kind === n.kind} />}
          <span>{y[n.kind]}</span>
        </Link>
      ))}
    </nav>
  );
}

export function YtFrame({ route }: { route: Extract<Route, { view: 'yt' }> }) {
  const compact = useCompact();
  const main = useRef<HTMLElement>(null);
  const page = route.page;
  const [open, setOpen] = useState<Tab | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const openOn = useCallback((tab: Tab) => setOpen(tab), []);
  useYtShortcuts(openOn);
  // Going to a page closes the full-screen player.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is what closes it
  useEffect(() => setOpen(null), [page]);
  // A new page starts at its top, its heading focused for keyboard and screen-reader users.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is what moves focus and scroll
  useEffect(() => {
    main.current?.scrollTo(0, 0);
    if (!(document.activeElement instanceof HTMLInputElement))
      main.current?.querySelector('h1')?.focus({ preventScroll: true });
  }, [page]);
  const day = new Date().toLocaleDateString('en-GB', { weekday: 'long' });

  return (
    <div className="yt" data-compact={compact || undefined}>
      <header className="yt-masthead">
        <Link className="yt-mast-title" to={{ view: 'yt', page: { kind: 'home' } }}>
          <span className="yt-mast-name">{strings.app}</span>
          <span className="yt-kicker">{y.edition(day)}</span>
        </Link>
        <YtSearch initial={page.kind === 'search' ? page.q : ''} />
        <div className="yt-bar-end">
          {!compact && <ModeSwitch />}
          <AccountMenu />
        </div>
      </header>
      {!compact && <Nav page={page} className="yt-tabs" icons={false} />}
      <main className="yt-main" ref={main}>
        <div className="yt-page">
          <YtPageView page={page} />
        </div>
      </main>
      {open && <NowPlaying onClose={close} tab={open} onTab={openOn} />}
      <PlayerBar compact={compact} onOpen={openOn} />
      {compact && <Nav page={page} className="yt-tabs yt-tabs--bottom" icons />}
      <ToastRegion />
      <SessionExpiredSheet />
    </div>
  );
}
