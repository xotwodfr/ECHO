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
