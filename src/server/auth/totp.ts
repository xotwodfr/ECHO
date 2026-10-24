import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP (SETTINGS_AND_SECURITY.md §4.5; RFC 6238 on RFC 4226): HMAC-SHA1, 6 digits, 30 s steps,
// ±1 step. The caller stores the last accepted step so a code is never accepted twice.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_S = 30;

/** RFC 4648 base32, no padding. */
export function base32(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(s: string) {
  const clean = s.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32. */
export const newTotpSecret = () => base32(randomBytes(20));

/** The HOTP value for counter `step` (RFC 4226 dynamic truncation). */
export function hotp(key: Buffer, step: number, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = (h[h.length - 1] as number) & 15;
  const bin = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}

export const stepAt = (unixMs: number) => Math.floor(unixMs / 1000 / STEP_S);

/**
 * The step `code` is valid for (now ±1), or null. A step at or before `lastStep` is refused, so a
 * code (or an older one) cannot be replayed.
 */
export function verifyTotp(secret: string, code: string, unixMs: number, lastStep: number | null) {
  if (!/^\d{6}$/.test(code)) return null;
  const key = fromBase32(secret);
  const now = stepAt(unixMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) return step;
  }
  return null;
}

export const otpauthUri = (username: string, secret: string) =>
  `otpauth://totp/ECHO:${encodeURIComponent(username)}?secret=${secret}&issuer=ECHO`;
