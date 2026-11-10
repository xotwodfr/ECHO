import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSealer, loadMasterKey, subkey } from './crypto.ts';

const master = randomBytes(32);
const where = { table: 'connections', rowId: 7, column: 'secret_enc' };

describe('master key (SETTINGS_AND_SECURITY.md §3.2)', () => {
  const file = (content: string) => {
    const p = join(mkdtempSync(join(tmpdir(), 'echo-key-')), 'k');
    writeFileSync(p, content);
    return p;
  };

  it('loads 32 base64 bytes, trailing newline allowed', () => {
    expect(loadMasterKey(file(`${master.toString('base64')}\n`))).toEqual(master);
  });

  it('refuses a missing file, a short key or something that is not base64', () => {
    expect(() => loadMasterKey('/nonexistent/key')).toThrow(/missing/);
    expect(() => loadMasterKey(file(randomBytes(16).toString('base64')))).toThrow(/32 bytes/);
    expect(() =>
      loadMasterKey(file('not base64 at all, but long enough to be 32 bytes ok')),
    ).toThrow(/32 bytes/);
  });
});

describe('sealed values', () => {
  const s = createSealer(master);

  it('round-trips, with a fresh nonce every time', () => {
    const a = s.seal('navidrome-password', where);
    const b = s.seal('navidrome-password', where);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:[\w-]{16}:[\w-]+$/);
    expect(s.open(a, where)).toBe('navidrome-password');
    expect(s.open(s.seal('', where), where)).toBe('');
  });

  it('a ciphertext moved to another row or column does not open (AAD)', () => {
    const c = s.seal('secret', where);
    expect(() => s.open(c, { ...where, rowId: 8 })).toThrow();
    expect(() => s.open(c, { ...where, column: 'config_json' })).toThrow();
    expect(() => s.open(c, { ...where, table: 'server_settings' })).toThrow();
  });

  it('tampering or another master key is detected', () => {
    const c = s.seal('secret', where);
    const [v, n, b] = c.split(':') as [string, string, string];
    const flipped = Buffer.from(b, 'base64url');
    flipped[0] = (flipped[0] as number) ^ 1;
    expect(() => s.open(`${v}:${n}:${flipped.toString('base64url')}`, where)).toThrow();
    expect(() => createSealer(randomBytes(32)).open(c, where)).toThrow();
    expect(() => s.open('v2:x:y', where)).toThrow(/not a sealed value/);
    expect(() => s.open('plain text', where)).toThrow(/not a sealed value/);
  });

  it('purpose subkeys are distinct and stable', () => {
    expect(subkey(master, 'stream-url')).toEqual(subkey(master, 'stream-url'));
    expect(subkey(master, 'secrets')).not.toEqual(subkey(master, 'stream-url'));
    expect(subkey(master, 'secrets')).not.toEqual(master);
  });
});
