import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../view.ts';
import { savedMode, switchMode } from './mode.ts';

// Which world this device is in (spec call 8): remembered per device, never a crash when storage
// is blocked (a private window).

describe('the mode switch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('savedMode defaults to navidrome when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(savedMode()).toBe('navidrome');
  });

  it('switchMode saves and navigates', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const went: Route[] = [];
    switchMode('youtube', (r) => went.push(r));
    expect(store.get('echo.mode')).toBe('youtube');
    expect(savedMode()).toBe('youtube');
    switchMode('navidrome', (r) => went.push(r));
    expect(savedMode()).toBe('navidrome');
    expect(went).toEqual([{ view: 'yt', page: { kind: 'home' } }, { view: 'home' }]);
  });
});
