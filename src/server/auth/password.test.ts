import { describe, expect, it } from 'vitest';
import {
  CODE_PARAMS,
  DUMMY_HASH,
  hashSecret,
  needsRehash,
  passwordProblem,
  verifySecret,
} from './password.ts';

describe('passwords (SETTINGS_AND_SECURITY.md §4.3)', () => {
  it('12–256 characters (counted as characters, not bytes), not common', () => {
    expect(passwordProblem('short')).toMatch(/12/);
    expect(passwordProblem('a'.repeat(12))).toBeNull();
    expect(passwordProblem('ü'.repeat(12))).toBeNull();
    expect(passwordProblem('a'.repeat(257))).toMatch(/256/);
    expect(passwordProblem('Unbelievable')).toBe('too common');
    expect(passwordProblem('correct horse battery staple')).toBeNull();
  });

  it('Argon2id PHC round trip; wrong passwords and malformed hashes fail', async () => {
    const h = await hashSecret('correct horse battery staple', CODE_PARAMS);
    expect(h).toMatch(/^\$argon2id\$v=19\$m=8192,t=1,p=1\$/);
    expect(await verifySecret('correct horse battery staple', h)).toBe(true);
    expect(await verifySecret('correct horse battery stapler', h)).toBe(false);
    expect(await verifySecret('x', 'not a hash')).toBe(false);
    expect(await hashSecret('same', CODE_PARAMS)).not.toBe(await hashSecret('same', CODE_PARAMS));
  });

  it('the production parameters are m 64 MiB, t 3, p 1; weaker hashes ask for a rehash', async () => {
    const h = await DUMMY_HASH;
    expect(h).toMatch(/\$m=65536,t=3,p=1\$/);
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash(await hashSecret('x', CODE_PARAMS))).toBe(true);
  });
});
