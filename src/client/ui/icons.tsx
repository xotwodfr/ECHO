// Icons (DESIGN_SYSTEM.md §9.1): drawn on a 24-unit grid at 1.5 stroke, rendered at --icon; the
// transport glyphs, the hearts and the active tab's icon are filled (`icon--solid`), as Spotify's.
// Decorative: the control that holds an icon carries the accessible name.

const PATHS = {
  play: <path d="M7 4.5v15l12.5-7.5z" />,
  pause: (
    <>
      <rect x="6.5" y="4.5" width="3.5" height="15" rx="1" />
      <rect x="14" y="4.5" width="3.5" height="15" rx="1" />
    </>
  ),
  previous: (
    <>
      <path d="M18 5v14L8 12z" />
      <path d="M6 5v14" />
    </>
  ),
  next: (
    <>
      <path d="M6 5v14l10-7z" />
      <path d="M18 5v14" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 7h3.5c4 0 7 10 11 10H21" />
      <path d="M3 17h3.5c1.6 0 2.9-1.6 4-3.6" />
      <path d="M13.5 9.6c1.1-1.4 2.4-2.6 4-2.6H21" />
      <path d="m18.5 4.5 2.5 2.5-2.5 2.5" />
      <path d="m18.5 14.5 2.5 2.5-2.5 2.5" />
    </>
  ),
  smartShuffle: (
    <>
      <path d="M3 7h3.5c4 0 7 10 11 10H21" />
      <path d="M3 17h3.5c1.6 0 2.9-1.6 4-3.6" />
      <path d="M13.5 9.6c1.1-1.4 2.4-2.6 4-2.6H21" />
      <path d="m18.5 4.5 2.5 2.5-2.5 2.5" />
      <path d="m18.5 14.5 2.5 2.5-2.5 2.5" />
      <path d="M10 1.5v4M8 3.5h4" />
    </>
  ),
  repeat: (
    <>
      <path d="M4 11V9a3 3 0 0 1 3-3h13" />
      <path d="m17 3 3 3-3 3" />
      <path d="M20 13v2a3 3 0 0 1-3 3H4" />
      <path d="m7 21-3-3 3-3" />
    </>
  ),
  repeatOne: (
    <>
      <path d="M4 11V9a3 3 0 0 1 3-3h13" />
      <path d="m17 3 3 3-3 3" />
      <path d="M20 13v2a3 3 0 0 1-3 3H4" />
      <path d="m7 21-3-3 3-3" />
      <path d="M11 10.5 12.5 9.5v5" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  muted: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="m16 9.5 5 5" />
      <path d="m21 9.5-5 5" />
    </>
  ),
  queue: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18.5" cy="12" r="1" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.2v.3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.7v.3" />
    </>
  ),
  // The Stage's views: a ragged column of lines, a pulse.
  lyrics: (
    <>
      <path d="M4 6h12" />
      <path d="M4 10.5h16" />
      <path d="M4 15h9" />
      <path d="M4 19.5h13" />
    </>
  ),
  visual: <path d="M3 12h3l2.5-6 4 12 3-9 2 3H21" />,
  // A half-lit disc in a ring of rays: the backdrop's brightness.
  brightness: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8v8a4 4 0 0 0 0-8z" fill="currentColor" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  home: <path d="M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  // Your Library: three spines on a shelf, the last one leaning.
  library: <path d="M4.5 4v16M9.5 4v16M14 4.6l5.5 15" />,
  plus: <path d="M12 5v14M5 12h14" />,
  heart: (
    <path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z" />
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  // The Now Playing panel: a window with a pane at its right.
  nowPlaying: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M14 4.5v15" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.5M4 12h.5M4 18h.5" />,
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 18.7a9.5 9.5 0 0 0 0-13.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
    </>
  ),
  moon: <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" />,
  edit: <path d="M4.5 19.5h4l10-10-4-4-10 10zM13 7l4 4" />,
  trash: <path d="M5 7h14M10 4h4M7 7l1 13h8l1-13M10.5 10.5v6M13.5 10.5v6" />,
  music: (
    <>
      <path d="M9 17.5V6l10-2v11.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M4 9V5a1 1 0 0 1 1-1h4" />
      <path d="M15 4h4a1 1 0 0 1 1 1v4" />
      <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
      <path d="M9 20H5a1 1 0 0 1-1-1v-4" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
