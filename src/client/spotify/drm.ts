import { strings } from '../strings.ts';

// Widevine detection at Spotify connect time (TECHNICAL_ARCHITECTURE.md §2.2, BRW-02): the Web
// Playback SDK needs EME with Widevine. When it is missing, the fix depends on the browser.

export type DrmResult = { ok: true } | { ok: false; browser: 'firefox' | 'chromium' | 'other' };

const CONFIG: MediaKeySystemConfiguration[] = [
  {
    initDataTypes: ['cenc'],
    audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
  },
];

export function browserFamily(ua = navigator.userAgent): 'firefox' | 'chromium' | 'other' {
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrom(e|ium)\//.test(ua)) return 'chromium';
  return 'other';
}

export async function probeWidevine(nav: Navigator = navigator): Promise<DrmResult> {
  try {
    if (!nav.requestMediaKeySystemAccess) throw new Error('no EME');
    await nav.requestMediaKeySystemAccess('com.widevine.alpha', CONFIG);
    return { ok: true };
  } catch {
    return { ok: false, browser: browserFamily(nav.userAgent) };
  }
}

export const drmGuidance = (r: Exclude<DrmResult, { ok: true }>) => strings.spotify.drm[r.browser];
