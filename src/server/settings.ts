import { Hono, type MiddlewareHandler } from 'hono';
import { type AuthEnv, jsonObject } from './auth/routes.ts';
import type { Db } from './db/db.ts';

// Per-user preferences that follow the user (SETTINGS_AND_SECURITY.md §7.1, `user_settings`,
// schema version 2). The per-device ones (`visuals.quality`, `playback.quality`) stay in the
// browser's localStorage and never reach the server. Every key is validated; unknown keys and
// wrong values are refused, never stored.

type Check = (v: unknown) => boolean;
const oneOf =
  (...xs: (string | number)[]): Check =>
  (v) =>
    xs.includes(v as string | number);
const subsetOf =
  (...xs: string[]): Check =>
  (v) =>
    Array.isArray(v) &&
    v.length <= xs.length &&
    v.every((x) => xs.includes(x)) &&
    new Set(v).size === v.length;
const bool: Check = (v) => typeof v === 'boolean';
const intIn =
  (min: number, max: number, step = 1): Check =>
  (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max && v % step === 0;

const SCHEMA = {
  playback: {
    defaultProvider: { check: oneOf('navidrome', 'spotify'), default: 'navidrome' },
    crossfadeSec: { check: intIn(0, 8), default: 0 },
    replayGain: { check: oneOf('off', 'track', 'album', 'auto'), default: 'auto' },
    scrobble: { check: bool, default: true },
    autoplay: { check: bool, default: true },
  },
  lyrics: {
    sizeScale: { check: oneOf(0.85, 1, 1.15, 1.3), default: 1 },
    globalOffsetMs: { check: intIn(-2000, 2000, 50), default: 0 },
    showUnsynced: { check: bool, default: true },
    announceLines: { check: bool, default: false },
    disabledSources: {
      check: subsetOf('navidrome', 'spicy', 'netease', 'lrclib', 'navidrome-plain'),
      default: [] as string[],
    },
  },
  visuals: {
    mode: { check: oneOf('auto', 'reverb', 'ambient', 'still'), default: 'auto' },
    intensity: { check: oneOf('subtle', 'balanced', 'expressive'), default: 'expressive' },
    motion: { check: oneOf('system', 'full', 'reduced', 'off'), default: 'system' },
    grain: { check: bool, default: false },
    pointerParallax: { check: bool, default: true },
  },
} as const;

type Section = keyof typeof SCHEMA;
type Values<S> = { -readonly [K in keyof S]: S[K] extends { default: infer D } ? D : never };
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer E)[]
        ? Widen<E>[]
        : T;
export type UserSettings = { version: 2 } & {
  [S in Section]: { [K in keyof Values<(typeof SCHEMA)[S]>]: Widen<Values<(typeof SCHEMA)[S]>[K]> };
};

const defaults = (): UserSettings =>
  ({
    version: 2,
    ...Object.fromEntries(
      Object.entries(SCHEMA).map(([s, keys]) => [
        s,
        Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, d.default])),
      ]),
    ),
  }) as UserSettings;

export function userSettings(db: Db, userId: number): UserSettings {
  const row = db.prepare('SELECT json FROM user_settings WHERE user_id = ?').get(userId) as
    | { json: string }
    | undefined;
  const out = defaults() as unknown as Record<string, Record<string, unknown>>;
  const saved = row ? (JSON.parse(row.json) as Record<string, Record<string, unknown>>) : {};
  for (const [s, keys] of Object.entries(SCHEMA))
    for (const [k, d] of Object.entries(keys)) {
      const v = saved[s]?.[k];
      if (v !== undefined && d.check(v)) (out[s] as Record<string, unknown>)[k] = v;
    }
  return out as unknown as UserSettings;
}

/** A partial update's problem, or null when every key and value is known and valid. */
function problem(b: unknown): string | null {
  if (!b || typeof b !== 'object') return 'not an object';
  for (const [s, keys] of Object.entries(b as Record<string, unknown>)) {
    // Own keys only: `constructor` or `toString` must not find Object's members.
    const schema = Object.hasOwn(SCHEMA, s)
      ? (SCHEMA[s as Section] as Record<string, { check: Check }>)
      : undefined;
    if (!schema || !keys || typeof keys !== 'object') return `unknown section ${s}`;
    for (const [k, v] of Object.entries(keys)) {
      if (!Object.hasOwn(schema, k) || !schema[k]) return `unknown key ${s}.${k}`;
      if (!schema[k].check(v)) return `bad value for ${s}.${k}`;
    }
  }
  return null;
}

export function settingsRoutes(db: Db, requireUser: MiddlewareHandler<AuthEnv>) {
  const app = new Hono<AuthEnv>();

  app.get('/me/settings', requireUser, (c) => c.json(userSettings(db, c.var.user.id)));

  app.put('/me/settings', requireUser, async (c) => {
    const b = (await jsonObject(c)) as Record<string, Record<string, unknown>> | null;
    const why = b ? problem(b) : 'not an object';
    if (!b || why) return c.json({ error: 'bad_settings', detail: why }, 400);
    const next = userSettings(db, c.var.user.id) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    for (const [s, keys] of Object.entries(b)) Object.assign(next[s] as object, keys);
    db.prepare(
      `INSERT INTO user_settings (user_id, json, version) VALUES (?, ?, 2)
       ON CONFLICT (user_id) DO UPDATE SET json = excluded.json, version = 2`,
    ).run(c.var.user.id, JSON.stringify(next));
    return c.json(next);
  });

  return app;
}
