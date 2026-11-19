import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_IDS } from '../shared/themes.ts';
import { applyAppearance, schemeOf, THEMES, themeOf } from './appearance.ts';
import { prefsStore, setPref } from './prefs.ts';

// Themes (Settings → Preferences → Appearance): Android's ThemePreset on the web.

describe('the themes', () => {
  const tokens = readFileSync('src/client/tokens.css', 'utf8');

  it("are Android's, Material You aside, each with its palette in tokens.css", () => {
    expect(THEMES.map((t) => t.id)).toEqual(THEME_IDS.filter((id) => id !== 'materialyou'));
    for (const t of THEMES) expect(tokens, t.id).toContain(`[data-theme="${t.id}"]`);
  });

  it('give the materials their own looks', () => {
    const made = THEMES.filter((t) => t.material).map((t) => [t.id, t.material]);
    expect(made).toEqual([
      ['clay', 'clay'],
      ['yarn', 'yarn'],
      ['glass', 'glass'],
      ['paper', 'paper'],
      ['hifi', 'hifi'],
    ]);
  });

  it('show Material You and anything unknown as ECHO', () => {
    expect(themeOf('materialyou').id).toBe('echo');
    expect(themeOf('winamp').id).toBe('echo');
    expect(themeOf('spotify').id).toBe('spotify');
  });
});

describe('light or dark', () => {
  const t = (id: string) => themeOf(id);

  it("is the theme's own by default, the system's where the theme has none", () => {
    expect(schemeOf(t('spotify'), 'theme', false)).toBe('dark');
    expect(schemeOf(t('apple'), 'theme', true)).toBe('light');
    expect(schemeOf(t('mono'), 'theme', true)).toBe('dark');
    expect(schemeOf(t('mono'), 'theme', false)).toBe('light');
  });

  it('keeps ECHO dark, as the web always was', () => {
    expect(schemeOf(t('echo'), 'theme', false)).toBe('dark');
  });

  it('follows the system, or stays fixed, when the user says so', () => {
    expect(schemeOf(t('spotify'), 'system', false)).toBe('light');
    expect(schemeOf(t('apple'), 'system', true)).toBe('dark');
    expect(schemeOf(t('apple'), 'dark', false)).toBe('dark');
    expect(schemeOf(t('spotify'), 'light', true)).toBe('light');
  });

  it("falls back to the theme's own for a damaged copy", () => {
    expect(schemeOf(t('apple'), 'dim' as never, true)).toBe('light');
  });
});

describe('<html> carries the theme', () => {
  const root = () => {
    const dataset: Record<string, string> = {};
    return { dataset } as unknown as HTMLElement;
  };

  it('as data-theme, data-scheme and, for a material, data-material', () => {
    const el = root();
    applyAppearance(el, { theme: 'clay', dark: 'dark' }, false);
    expect({ ...el.dataset }).toEqual({ theme: 'clay', scheme: 'dark', material: 'clay' });
    applyAppearance(el, { theme: 'materialyou', dark: 'theme' }, false);
    expect({ ...el.dataset }).toEqual({ theme: 'echo', scheme: 'dark' });
  });
});

describe('the choice follows the user', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    prefsStore.setState({ synced: false });
  });

  const stub = () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, s: string) => kept.set(k, s),
    });
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    return { kept, fetch };
  };

  it('to the server once it answered, with a copy here for the first paint', async () => {
    const { kept, fetch } = stub();
    prefsStore.setState({ synced: true });
    await setPref('appearance', 'theme', 'paper');
    expect(prefsStore.getState().appearance.theme).toBe('paper');
    expect(kept.get('echo.appearance.theme')).toBe('"paper"');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/me/settings');
    expect(JSON.parse(String(init.body))).toEqual({ appearance: { theme: 'paper' } });
  });

  it('stays in this browser without a server (the fixture shell, signed out)', async () => {
    const { kept, fetch } = stub();
    await setPref('appearance', 'dark', 'light');
    expect(prefsStore.getState().appearance.dark).toBe('light');
    expect(kept.get('echo.appearance.dark')).toBe('"light"');
    expect(fetch).not.toHaveBeenCalled();
  });
});
