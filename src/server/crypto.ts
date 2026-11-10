import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Secrets at rest (SETTINGS_AND_SECURITY.md §3.2). The master key is 32 random bytes from a Docker
// secret file, never in the database or the image; without it the server does not start. Every
// secret value is AES-256-GCM with a fresh 96-bit nonce and AAD `table|rowId|column`, so a
// ciphertext cannot be moved to another row or column. Purpose keys are HKDF-SHA256 subkeys of the
// master key with distinct labels.

export const MASTER_KEY_FILE = '/run/secrets/echo_master_key';
const VERSION = 'v1';

/** Reads the base64 master key; throws (the server refuses to start) if missing or not 32 bytes. */
export function loadMasterKey(path = MASTER_KEY_FILE): Buffer {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8').trim();
  } catch {
    throw new Error(`master key file ${path} is missing (SETTINGS_AND_SECURITY.md §3.2)`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, ''))
    throw new Error(`master key in ${path} must be 32 bytes, base64 (openssl rand -base64 32)`);
  return key;
}

export type Purpose = 'secrets' | 'stream-url';

/** A 32-byte subkey of the master key for one purpose. */
export const subkey = (master: Buffer, purpose: Purpose) =>
  Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `echo/${purpose}/v1`, 32));

export interface Where {
  table: string;
  rowId: string | number;
  column: string;
}

const aad = (w: Where) => Buffer.from(`${w.table}|${w.rowId}|${w.column}`, 'utf8');

/** `remember` sees every plaintext opened, so the log redactor can mask it word for word (§9). */
export function createSealer(master: Buffer, opts: { remember?: (plain: string) => void } = {}) {
  const key = subkey(master, 'secrets');
  const sealer = {
    /** `v1:<nonce>:<ciphertext+tag>`, base64url. */
    seal(plain: string, where: Where): string {
      const nonce = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, nonce).setAAD(aad(where));
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);
      return `${VERSION}:${nonce.toString('base64url')}:${body.toString('base64url')}`;
    },
    /** The plaintext, or throws if the value was tampered with, moved, or sealed with another key. */
    open(sealed: string, where: Where): string {
      const [v, n, b] = sealed.split(':');
      if (v !== VERSION || !n || !b) throw new Error('not a sealed value');
      const body = Buffer.from(b, 'base64url');
      if (body.length < 16) throw new Error('not a sealed value');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(n, 'base64url')).setAAD(
        aad(where),
      );
      d.setAuthTag(body.subarray(body.length - 16));
      const plain = Buffer.concat([
        d.update(body.subarray(0, body.length - 16)),
        d.final(),
      ]).toString('utf8');
      opts.remember?.(plain);
      return plain;
    },
    /**
     * The plaintext, or null when it cannot be opened: after a restore without the master key,
     * a connection needs re-entry and nothing else breaks (DEP-03).
     */
    tryOpen(sealed: string, where: Where): string | null {
      try {
        return sealer.open(sealed, where);
      } catch {
        return null;
      }
    },
  };
  return sealer;
}

export type Sealer = ReturnType<typeof createSealer>;
