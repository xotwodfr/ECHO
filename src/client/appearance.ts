import { DARK_MODES, type DarkMode, type ThemeId } from '../shared/themes.ts';

// Themes (Settings → Preferences → Appearance), Android's (Android/.../ui/Theme.kt `ThemePreset`)
// on the web: <html data-theme> picks the palette, shapes and type in tokens.css, <html
// data-scheme> light or dark, <html data-material> the hand-made looks in themes.css (Clay, Yarn,
// Liquid glass, Paper, Retro hi-fi). ECHO is the web as it was: Fluent 2 over the album's Mica.

export type Material = 'clay' | 'yarn' | 'glass' | 'paper' | 'hifi';

export interface Theme {
  id: ThemeId;
  label: string;
  blurb: string;
  /** Light or dark when the user leaves it to the theme; null follows the system. */
  dark: boolean | null;
  material?: Material;
}

/** The picker's themes, in Android's order. Material You (the wallpaper's colours) has no web
 * equivalent: it is not offered, and shows as ECHO when another device chose it. */
export const THEMES: readonly Theme[] = [
  // The web was dark only before themes: ECHO stays dark unless the user says otherwise.
  { id: 'echo', label: 'ECHO', blurb: 'Accent from the playing album', dark: true },
  { id: 'apple', label: 'Apple Music style', blurb: 'Red, light, large bold titles', dark: false },
  { id: 'spotify', label: 'Spotify style', blurb: 'Green on black, square art', dark: true },
  {
    id: 'soundcloud',
    label: 'SoundCloud style',
    blurb: 'Orange, light, flat and square',
    dark: false,
  },
  { id: 'deezer', label: 'Deezer style', blurb: 'Purple, dark, rounded', dark: true },
  { id: 'qobuz', label: 'Qobuz style', blurb: 'Black and white, thin editorial type', dark: true },
  { id: 'tidal', label: 'Tidal style', blurb: 'Black, white and cyan, minimal', dark: true },
  { id: 'youtube', label: 'YouTube Music style', blurb: 'Red, dark, round art', dark: true },
  {
    id: 'clay',
    label: 'Clay',
    blurb: 'Pastel plasticine, shaped by hand',
    dark: false,
    material: 'clay',
  },
  {
    id: 'yarn',
    label: 'Yarn',
    blurb: 'Knitted in cosy autumn colours',
    dark: false,
    material: 'yarn',
  },
  {
    id: 'glass',
    label: 'Liquid glass',
    blurb: "Frosted panes over the album's colours",
    dark: true,
    material: 'glass',
  },
  {
    id: 'paper',
    label: 'Paper & origami',
    blurb: 'Folded card, polaroids and tape',
    dark: false,
    material: 'paper',
  },
  {
    id: 'hifi',
    label: 'Retro hi-fi',
    blurb: 'Wood veneer, brushed aluminium, a teal glow',
    dark: true,
    material: 'hifi',
  },
  { id: 'mono', label: 'Monochrome', blurb: 'Greys only: the art is the colour', dark: null },
];

const ECHO = THEMES[0] as Theme;

/** The theme for an id: ECHO for Material You and anything unknown. */
export const themeOf = (id: string): Theme => THEMES.find((t) => t.id === id) ?? ECHO;

/** Light or dark, as the user chose over the theme's own default and the system's. */
export function schemeOf(theme: Theme, chosen: DarkMode, systemDark: boolean): 'light' | 'dark' {
  const mode = DARK_MODES.includes(chosen) ? chosen : 'theme'; // an old or damaged copy
  const dark =
    mode === 'dark' ||
    (mode === 'system' && systemDark) ||
    (mode === 'theme' && (theme.dark ?? systemDark));
  return dark ? 'dark' : 'light';
}

/** Marks <html> (or `root`) with the theme, its scheme and its material. */
export function applyAppearance(
  root: HTMLElement,
  a: { theme: string; dark: DarkMode },
  systemDark: boolean,
) {
  const theme = themeOf(a.theme);
  root.dataset.theme = theme.id;
  root.dataset.scheme = schemeOf(theme, a.dark, systemDark);
  if (theme.material) root.dataset.material = theme.material;
  else delete root.dataset.material;
}
