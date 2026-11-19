// The app's themes (Android's `ThemePreset`, Android/.../ui/Theme.kt), shared by the server, which
// validates `appearance.theme` in /me/settings, and the web client, which draws them (tokens.css,
// themes.css). "materialyou" is Android's wallpaper theme: the server keeps it so one account can
// carry it, and the web shows it as ECHO.

export const THEME_IDS = [
  'echo',
  'apple',
  'spotify',
  'soundcloud',
  'deezer',
  'qobuz',
  'tidal',
  'youtube',
  'clay',
  'yarn',
  'glass',
  'paper',
  'hifi',
  'materialyou',
  'mono',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** Light or dark: the theme's own default, the system's, or fixed (Android's `DarkMode`). */
export const DARK_MODES = ['theme', 'system', 'light', 'dark'] as const;
export type DarkMode = (typeof DARK_MODES)[number];
