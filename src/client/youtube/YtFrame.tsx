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
import { ModeSwitch } from './ModeSwitch.tsx';
import { NowPlaying } from './NowPlaying.tsx';
import { PlayerBar } from './PlayerBar.tsx';
import { YtPageView } from './pages.tsx';
import { YtSearch } from './parts.tsx';

// YouTube Music mode's frame (mockup A, spec): a top bar (ECHO's wordmark, search, the switch, the
// account), a left menu on wide screens or bottom tabs on phones, the page, and the player bar.
// Only what is drawn differs from Navidrome mode: the player and queue underneath are the same.

const y = strings.youtube;
const NAV: { kind: 'home' | 'explore' | 'library'; icon: IconName }[] = [
  { kind: 'home', icon: 'home' },
  { kind: 'explore', icon: 'radio' },
  { kind: 'library', icon: 'library' },
];

function Nav({ page, className }: { page: YtRoute; className: string }) {
  return (
    <nav className={className} aria-label={y.name}>
      {NAV.map((n) => (
        <Link
          key={n.kind}
          className="yt-nav-link"
          to={{ view: 'yt', page: { kind: n.kind } }}
          aria-current={page.kind === n.kind ? 'page' : undefined}
        >
          <Icon name={n.icon} solid={page.kind === n.kind} />
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
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Going to a page closes the full-screen player.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is what closes it
  useEffect(() => setOpen(false), [page]);
  // A new page starts at its top, its heading focused for keyboard and screen-reader users.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is what moves focus and scroll
  useEffect(() => {
    main.current?.scrollTo(0, 0);
    if (!(document.activeElement instanceof HTMLInputElement))
      main.current?.querySelector('h1')?.focus({ preventScroll: true });
  }, [page]);

  return (
    <div className="yt" data-compact={compact || undefined}>
      <header className="yt-bar">
        <Link className="yt-wordmark" to={{ view: 'yt', page: { kind: 'home' } }}>
          {strings.app}
        </Link>
        <YtSearch initial={page.kind === 'search' ? page.q : ''} />
        <div className="yt-bar-end">
          {!compact && <ModeSwitch />}
          <AccountMenu />
        </div>
      </header>
      {!compact && <Nav page={page} className="yt-nav" />}
      <main className="yt-main" ref={main}>
        <div className="yt-page">
          <YtPageView page={page} />
        </div>
      </main>
      {open && <NowPlaying onClose={close} />}
      <PlayerBar compact={compact} onOpen={() => setOpen(true)} />
      {compact && <Nav page={page} className="yt-tabs" />}
      <ToastRegion />
      <SessionExpiredSheet />
    </div>
  );
}
