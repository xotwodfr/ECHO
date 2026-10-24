import { describe, expect, it } from 'vitest';
import { strings } from '../strings.ts';
import { browserFamily, drmGuidance, probeWidevine } from './drm.ts';

// BRW-02: missing Widevine is detected, and the fix-it text names the browser's own fix.

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const CHROMIUM =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const nav = (ua: string, ok: boolean) =>
  ({
    userAgent: ua,
    requestMediaKeySystemAccess: async () => {
      if (!ok) throw new DOMException('Unsupported keySystem', 'NotSupportedError');
      return {};
    },
  }) as unknown as Navigator;

describe('Widevine probe', () => {
  it('passes when the CDM answers', async () => {
    expect(await probeWidevine(nav(CHROMIUM, true))).toEqual({ ok: true });
  });
  it('gives Firefox and Chromium their own guidance', async () => {
    const ff = await probeWidevine(nav(FIREFOX, false));
    const cr = await probeWidevine(nav(CHROMIUM, false));
    expect(ff).toEqual({ ok: false, browser: 'firefox' });
    expect(cr).toEqual({ ok: false, browser: 'chromium' });
    if (!ff.ok) expect(drmGuidance(ff)).toBe(strings.spotify.drm.firefox);
    if (!cr.ok) expect(drmGuidance(cr)).toMatch(/chromium-widevine/);
    expect(browserFamily('Safari/605')).toBe('other');
  });
  it('a browser without EME at all is "other"-guided, not a crash', async () => {
    expect(await probeWidevine({ userAgent: 'X' } as Navigator)).toEqual({
      ok: false,
      browser: 'other',
    });
  });
});
