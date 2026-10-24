import { describe, expect, it } from 'vitest';
import { base32, fromBase32, hotp, otpauthUri, stepAt, verifyTotp } from './totp.ts';

// RFC 6238 appendix B (SHA-1 rows) and RFC 4226 appendix D.
const RFC_KEY = Buffer.from('12345678901234567890');

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T = %i s → %s (8 digits, SHA-1)', (t, code) => {
    expect(hotp(RFC_KEY, stepAt(t * 1000), 8)).toBe(code);
  });

  it('RFC 4226 HOTP values for counters 0–9', () => {
    const want = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expect(want.map((_, c) => hotp(RFC_KEY, c))).toEqual(want);
  });

  it('base32 round-trips (RFC 4648 vectors)', () => {
    expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(fromBase32('MZXW6YTBOI').toString()).toBe('foobar');
    expect(fromBase32(base32(RFC_KEY))).toEqual(RFC_KEY);
    expect(() => fromBase32('not!base32')).toThrow();
  });

  it('accepts the current step ±1, refuses replays and older steps', () => {
    const secret = base32(RFC_KEY);
    const t = 1111111111 * 1000;
    const now = stepAt(t);
    const code = hotp(RFC_KEY, now);
    expect(verifyTotp(secret, code, t, null)).toBe(now);
    expect(verifyTotp(secret, hotp(RFC_KEY, now - 1), t, null)).toBe(now - 1);
    expect(verifyTotp(secret, hotp(RFC_KEY, now + 1), t, null)).toBe(now + 1);
    expect(verifyTotp(secret, hotp(RFC_KEY, now - 2), t, null)).toBeNull();
    expect(verifyTotp(secret, code, t, now)).toBeNull(); // replay
    expect(verifyTotp(secret, hotp(RFC_KEY, now - 1), t, now)).toBeNull(); // older than the last
    expect(verifyTotp(secret, '12345', t, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', t, null)).toBeNull();
  });

  it('builds the otpauth URI', () => {
    expect(otpauthUri('ada lovelace', 'ABC')).toBe(
      'otpauth://totp/ECHO:ada%20lovelace?secret=ABC&issuer=ECHO',
    );
  });
});
