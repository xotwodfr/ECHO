import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

// SQLite at /data/echo.db (TECHNICAL_ARCHITECTURE.md §5.5): better-sqlite3 (node:sqlite was not yet
// stable in M1), WAL, foreign keys on. Migrations are numbered SQL, applied in order inside one
// transaction each, and tracked with PRAGMA user_version. They only ever append.

export type Db = Database.Database;

/** Times are Unix milliseconds. Secrets are `v1:` ciphertexts (crypto.ts), hashes are hex. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    totp_secret_enc TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER,
    created_at INTEGER NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE recovery_codes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX recovery_codes_user ON recovery_codes(user_id);
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('web', 'device')),
    name TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip_hint TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE invites (
    token_hash TEXT PRIMARY KEY,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT,
    expires_at INTEGER NOT NULL,
    used_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE connections (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('navidrome', 'spotify')),
    config_json TEXT NOT NULL,
    secret_enc TEXT,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, provider)
  );
  CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    json TEXT NOT NULL,
    version INTEGER NOT NULL
  );
  CREATE TABLE server_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT,
    secret_enc TEXT
  );
  CREATE TABLE track_overrides (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_key TEXT NOT NULL,
    offset_ms INTEGER NOT NULL DEFAULT 0,
    pinned_source TEXT,
    PRIMARY KEY (user_id, track_key)
  );
  CREATE TABLE queue_state (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX audit_log_at ON audit_log(at);
  `,
  // M7: the shared Spotify-ID mappings for Navidrome tracks (LYRICS_INTEGRATION.md §4.3), keyed by
  // the Navidrome server and track id; spotify_id NULL means "none found".
  `
  CREATE TABLE spotify_ids (
    key TEXT PRIMARY KEY,
    spotify_id TEXT,
    expires_at INTEGER NOT NULL
  );
  `,
  // Spotify matching (LYRICS_INTEGRATION.md §4.3, lyrics/spotifyMatch.ts): one row per track per
  // Navidrome server, kept until corrected. spotify_ids is a JSON array, best first; NULL with a
  // non-empty `tried` means none found. The 30-day spotify_ids cache it replaces was never filled.
  `
  DROP TABLE spotify_ids;
  CREATE TABLE spotify_matches (
    scope TEXT NOT NULL,
    navidrome_id TEXT NOT NULL,
    spotify_ids TEXT,
    method TEXT CHECK (method IN ('manual', 'spotify', 'lb-mbid', 'lb-meta')),
    tried TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    duration_ms INTEGER,
    isrc TEXT,
    mbid TEXT,
    checked_at INTEGER NOT NULL,
    PRIMARY KEY (scope, navidrome_id)
  );
  `,
  // Project 2 of the Spotify redesign: what each user played (Navidrome songs past the scrobble
  // point), for Made For You, Jump back in and Wrapped (src/server/plays.ts). Kept two years.
  `
  CREATE TABLE plays (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    played_at INTEGER NOT NULL,
    track_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    artist_id TEXT,
    album TEXT NOT NULL,
    album_id TEXT,
    cover TEXT,
    duration_ms INTEGER NOT NULL,
    context_kind TEXT,
    context_id TEXT,
    context_title TEXT
  );
  CREATE INDEX plays_user_time ON plays (user_id, played_at);
  `,
  // Spotify playback was removed: its connections (sealed refresh tokens), the app's Client ID and
  // secret and the policy gates go, since nothing reads them. The Spotify-id matches stay (they key
  // Spicy Lyrics) and so does `spotify.matchLibrary`, the matching sweep's switch. The `connections`
  // CHECK still allows 'spotify': SQLite cannot alter it, and no row can use it any more.
  `
  DELETE FROM connections WHERE provider = 'spotify';
  DELETE FROM server_settings
    WHERE key IN ('spotify.clientId', 'spotify.clientSecret', 'spotify.gates.artPalette', 'spotify.gates.syncedLyrics');
  `,
];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: Db) {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > MIGRATIONS.length)
    throw new Error(`database is from a newer ECHO (schema ${current} > ${MIGRATIONS.length})`);
  for (let v = current; v < MIGRATIONS.length; v++)
    db.transaction(() => {
      db.exec(MIGRATIONS[v] as string);
      db.pragma(`user_version = ${v + 1}`);
    })();
}

export const SCHEMA_VERSION = MIGRATIONS.length;
