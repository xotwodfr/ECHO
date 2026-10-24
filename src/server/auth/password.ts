import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

// Passwords (SETTINGS_AND_SECURITY.md §4.3): 12–256 characters, no composition rules, not a common
// password; Argon2id (node:crypto) at m 64 MiB, t 3, p 1 (183 ms on the OptiPlex, M1), stored as a
// PHC string so the parameters can be raised later with rehash-on-login.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

/**
 * The entries of SecLists' 10k-most-common list (MIT) that are 12 or more characters long; the
 * other 9,990 are shorter and already fail the length rule.
 */
const COMMON = new Set([
  'masterbating',
  'unbelievable',
  'businessbabe',
  'contortionist',
  'masterbaiting',
  'masturbation',
  'pornographic',
  'scandinavian',
  'films+pic+galeries',
  'motherfucker',
]);

/** Why `pw` is not acceptable, or null. */
export function passwordProblem(pw: string): string | null {
  const n = [...pw].length;
  if (n < PASSWORD_MIN) return `at least ${PASSWORD_MIN} characters`;
  if (n > PASSWORD_MAX) return `at most ${PASSWORD_MAX} characters`;
  if (COMMON.has(pw.toLowerCase())) return 'too common';
  return null;
}

export interface Argon2Params {
  m: number; // KiB
  t: number;
  p: number;
}
export const PASSWORD_PARAMS: Argon2Params = { m: 65_536, t: 3, p: 1 };
/** Recovery codes are long random strings: low-cost parameters are enough (§3.1). */
export const CODE_PARAMS: Argon2Params = { m: 8_192, t: 1, p: 1 };

const derive = (message: string, nonce: Buffer, p: Argon2Params) =>
  new Promise<Buffer>((resolve, reject) =>
    argon2(
      'argon2id',
      { message, nonce, parallelism: p.p, tagLength: 32, memory: p.m, passes: p.t },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );

export async function hashSecret(secret: string, p: Argon2Params = PASSWORD_PARAMS) {
  const salt = randomBytes(16);
  const key = await derive(secret, salt, p);
  return `$argon2id$v=19$m=${p.m},t=${p.t},p=${p.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/;

export async function verifySecret(secret: string, phc: string): Promise<boolean> {
  const m = PHC.exec(phc);
  if (!m) return false;
  const want = Buffer.from(m[5] as string, 'base64url');
  const key = await derive(secret, Buffer.from(m[4] as string, 'base64url'), {
    m: Number(m[1]),
    t: Number(m[2]),
    p: Number(m[3]),
  });
  return key.length === want.length && timingSafeEqual(key, want);
}

/** True when a hash was made with weaker parameters than today's (rehash after a good login). */
export function needsRehash(phc: string, p: Argon2Params = PASSWORD_PARAMS) {
  const m = PHC.exec(phc);
  return !m || Number(m[1]) < p.m || Number(m[2]) < p.t;
}

/** Verified against for unknown usernames, so they take as long as known ones (§4.4). */
export const DUMMY_HASH = hashSecret(randomBytes(16).toString('hex'));
