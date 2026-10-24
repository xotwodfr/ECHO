import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('uses the documented defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 8080,
      logLevel: 'info',
      publicOrigin: null,
      dataDir: './data',
      masterKeyFile: '/run/secrets/echo_master_key',
      trustedProxy: [],
      navidromeUrl: null,
      devFixtures: false,
      lrclibUrl: 'https://lrclib.net',
      spicyUrl: 'https://api.spicylyrics.org',
    });
  });

  it('reads the trusted proxy list', () => {
    expect(loadConfig({ ECHO_TRUSTED_PROXY: '172.18.0.0/16, 10.0.0.2' }).trustedProxy).toEqual([
      '172.18.0.0/16',
      '10.0.0.2',
    ]);
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ ECHO_PORT: '', ECHO_LOG: '', ECHO_PUBLIC_ORIGIN: '' }).port).toBe(8080);
  });

  it('reads valid values', () => {
    const config = loadConfig({
      ECHO_PORT: '8787',
      ECHO_LOG: 'debug',
      ECHO_PUBLIC_ORIGIN: 'https://echo.example.com/',
    });
    expect(config).toEqual({
      port: 8787,
      logLevel: 'debug',
      publicOrigin: 'https://echo.example.com',
      dataDir: './data',
      masterKeyFile: '/run/secrets/echo_master_key',
      trustedProxy: [],
      navidromeUrl: null,
      devFixtures: false,
      lrclibUrl: 'https://lrclib.net',
      spicyUrl: 'https://api.spicylyrics.org',
    });
  });

  it.each(['0', '65536', '80.5', 'http', '-1'])('rejects ECHO_PORT=%s', (port) => {
    expect(() => loadConfig({ ECHO_PORT: port })).toThrow(/ECHO_PORT/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ ECHO_LOG: 'verbose' })).toThrow(/ECHO_LOG/);
  });

  it.each([
    'echo.example.com',
    'https://echo.example.com/app',
    'https://echo.example.com?x=1',
    'https://user:pw@echo.example.com',
    'ftp://echo.example.com',
  ])('rejects ECHO_PUBLIC_ORIGIN=%s', (origin) => {
    expect(() => loadConfig({ ECHO_PUBLIC_ORIGIN: origin })).toThrow(/ECHO_PUBLIC_ORIGIN/);
  });
});
