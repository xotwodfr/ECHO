// Outline icons (DESIGN_SYSTEM.md §9.1): drawn on a 24-unit grid at 1.5 stroke, rendered at --icon.
// Decorative: the control that holds an icon carries the accessible name.

const PATHS = {
  play: <path d="M7 4.5v15l12.5-7.5z" />,
  pause: (
    <>
      <path d="M8 5v14" />
      <path d="M16 5v14" />
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
  // The Stage's views: a ragged column of lines, a picture, a pulse.
  lyrics: (
    <>
      <path d="M4 6h12" />
      <path d="M4 10.5h16" />
      <path d="M4 15h9" />
      <path d="M4 19.5h13" />
    </>
  ),
  cover: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9.5" cy="9.5" r="1.5" />
      <path d="m20 15-4.5-4.5L6 20" />
    </>
  ),
  visual: <path d="M3 12h3l2.5-6 4 12 3-9 2 3H21" />,
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
