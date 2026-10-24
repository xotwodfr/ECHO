// Environment configuration (docs/TECHNICAL_ARCHITECTURE.md §6.3).
// M1 reads only what the server uses so far. Later milestones add their own keys
// (ECHO_NAVIDROME_URL, ECHO_TRUSTED_PROXY, the master key) when the code needing them lands.

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  port: number;
  logLevel: LogLevel;
  publicOrigin: string | null;
  dataDir: string; // database and caches (/data in the container)
  masterKeyFile: string; // the Docker secret (SETTINGS_AND_SECURITY.md §3.2)
  trustedProxy: string[]; // addresses or IPv4 CIDRs whose X-Forwarded-* are honoured (§5.1)
  navidromeUrl: string | null; // the default, always-allowed internal Navidrome URL (§6.1)
  devFixtures: boolean; // development and E2E only: generated-cover palettes without a session
  lrclibUrl: string; // LYRICS_INTEGRATION.md S3 (overridable for E2E mocks)
  spicyUrl: string; // S2
  spotifyAccountsUrl: string; // PKCE and tokens (overridable for E2E mocks)
  spotifyApiUrl: string;
  spotifyImageUrl: string; // where i.scdn.co covers are fetched from (overridable for E2E mocks)
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const rawPort = env.ECHO_PORT || '8080';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`ECHO_PORT must be an integer from 1 to 65535, got "${rawPort}"`);
  }

  const logLevel = env.ECHO_LOG || 'info';
  if (!LOG_LEVELS.includes(logLevel as LogLevel)) {
    throw new Error(`ECHO_LOG must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`);
  }

  return {
    port,
    logLevel: logLevel as LogLevel,
    publicOrigin: parseOrigin(env.ECHO_PUBLIC_ORIGIN),
    dataDir: env.ECHO_DATA_DIR || './data',
    masterKeyFile: env.ECHO_MASTER_KEY_FILE || '/run/secrets/echo_master_key',
    trustedProxy: (env.ECHO_TRUSTED_PROXY ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    navidromeUrl: env.ECHO_NAVIDROME_URL || null,
    devFixtures: env.ECHO_DEV_FIXTURES === '1',
    lrclibUrl: (env.ECHO_LRCLIB_URL || 'https://lrclib.net').replace(/\/+$/, ''),
    spicyUrl: (env.ECHO_SPICY_URL || 'https://api.spicylyrics.org').replace(/\/+$/, ''),
    spotifyAccountsUrl: (env.ECHO_SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com').replace(
      /\/+$/,
      '',
    ),
    spotifyApiUrl: (env.ECHO_SPOTIFY_API_URL || 'https://api.spotify.com').replace(/\/+$/, ''),
    spotifyImageUrl: (env.ECHO_SPOTIFY_IMAGE_URL || 'https://i.scdn.co').replace(/\/+$/, ''),
  };
}

function parseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ECHO_PUBLIC_ORIGIN must be a URL like https://echo.example.com, got "${raw}"`);
  }
  // An origin is scheme + host + port only. A path, query or credentials would make the
  // Host and Origin checks in M5 compare against the wrong value.
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    raw.replace(/\/$/, '') !== url.origin
  ) {
    throw new Error(`ECHO_PUBLIC_ORIGIN must be scheme://host[:port] with no path, got "${raw}"`);
  }
  return url.origin;
}
