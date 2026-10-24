import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSealer } from './crypto.ts';
import { createApp } from './index.ts';
import { createLogger, createSecretSet, redact } from './log.ts';
import { call, testDeps } from './testing.ts';

// SEC-04 (SETTINGS_AND_SECURITY.md §9): every secret type through every log path — log lines,
// error objects, access lines and unhandled errors — with no substring of it left.

// Fake secrets, assembled at runtime so the secret scanner does not read them as real ones.
const fake = (...parts: string[]) => parts.join('-');
const SECRETS = {
  navidromePassword: fake('navidrome-pass', 'Q7w9'),
  navidromeApiKey: fake('nd', 'api', 'key', '9f8e', '7d6c5b4a'),
  totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
  spotifyRefresh: 'AQD_refresh_TOKEN_x1y2z3',
  sessionToken: fake('kq3V1nXh8vYdZ0rT5uWm', '2bLc9aE4fG7iJ6oP1sR3tUw'),
  deviceToken: `echo_dt_${'D'.repeat(43)}`,
  spicyKey: ['sl', 'sk', 'liveKEY123456'].join('_'),
  subsonicToken: fake('5f4dcc3b5aa765d6', '1d8327deb882cf99'),
  subsonicSalt: 'c19b2d',
  streamSig: 'Zm9vYmFyYmF6cXV4c2lnbmF0dXJlMTIz',
  pkceVerifier: 'verifier-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  oauthCode: 'AQB-oauth-code-987654',
  accessToken: 'BQC-access-token-abcdef123456',
  password: 'correct horse battery staple',
  sealed: `v1:${'n'.repeat(16)}:${'c'.repeat(40)}`,
};

describe('redaction (SEC-04)', () => {
  it('every secret type, through log lines and error objects, leaves nothing behind', () => {
    const lines: string[] = [];
    const secrets = createSecretSet();
    // Values the server decrypts are remembered by the sealer.
    const sealer = createSealer(randomBytes(32), { remember: (p) => secrets.add(p) });
    for (const v of [
      SECRETS.navidromePassword,
      SECRETS.navidromeApiKey,
      SECRETS.totpSecret,
      SECRETS.spotifyRefresh,
    ]) {
      const w = { table: 't', rowId: 1, column: 'c' };
      sealer.open(sealer.seal(v, w), w);
    }
    const log = createLogger('debug', { write: (l) => lines.push(l), secrets: secrets.values });
    const url =
      `http://nd:4533/rest/stream?u=ada&t=${SECRETS.subsonicToken}&s=${SECRETS.subsonicSalt}` +
      `&p=${SECRETS.navidromePassword}&apiKey=${SECRETS.navidromeApiKey}`;
    log('warn', `fetch failed ${url}`, {
      signed: `/api/v1/navidrome/stream/x?uid=1&exp=2&sig=${SECRETS.streamSig}`,
      headers: {
        authorization: `Bearer ${SECRETS.deviceToken}`,
        cookie: `__Host-echo_session=${SECRETS.sessionToken}`,
      },
      oauth: `https://echo/api/v1/spotify/callback?code=${SECRETS.oauthCode}&state=x`,
      body: JSON.stringify({
        password: SECRETS.password,
        access_token: SECRETS.accessToken,
        code_verifier: 'x',
      }),
      tokenForm: `grant_type=authorization_code&code_verifier=${SECRETS.pkceVerifier}&refresh_token=${SECRETS.spotifyRefresh}`,
      spicy: `key ${SECRETS.spicyKey}`,
      sealedValue: SECRETS.sealed,
      totp: `secret is ${SECRETS.totpSecret}`,
      error: new Error(`upstream said ${SECRETS.navidromePassword} at ${url}`),
    });
    const out = lines.join('\n');
    for (const [name, value] of Object.entries(SECRETS)) expect(out, name).not.toContain(value);
    expect(out).toContain('«redacted»');
  });

  it('ordinary text and the deliberate setup URL survive', () => {
    expect(redact('listening on 8080, 3 albums, track t1')).toBe(
      'listening on 8080, 3 albums, track t1',
    );
    const setup = 'https://echo.example.com/setup#abcDEF123';
    expect(redact(setup)).toBe(setup);
  });

  it('access lines carry the route template, never the path or query; errors go through the redactor', async () => {
    const lines: string[] = [];
    const log = createLogger('debug', { write: (l) => lines.push(l) });
    const t = testDeps();
    // The palette service fails with a secret in its message: an unhandled error.
    const app = createApp({
      ...t.deps,
      log,
      palette: {
        get: async () => {
          throw new Error(`boom ${SECRETS.deviceToken} ${SECRETS.spicyKey}`);
        },
      },
    });
    await call(
      app,
      'GET',
      `/api/v1/navidrome/stream/al-1-t1?uid=1&exp=9999999999999&sig=${SECRETS.streamSig}`,
    );
    await call(app, 'GET', `/api/v1/lyrics?trackKey=navidrome:x&title=${SECRETS.password}`);
    const boom = await call(app, 'GET', '/api/v1/palette/fixture:night-sun');
    expect(boom.status).toBe(500);
    const out = lines.join('\n');
    expect(out).toContain('"route":"/api/v1/navidrome/stream/:id"');
    expect(out).not.toContain('al-1-t1');
    expect(out).not.toContain(SECRETS.streamSig);
    expect(out).not.toContain('horse');
    expect(out).not.toContain(SECRETS.deviceToken);
    expect(out).not.toContain(SECRETS.spicyKey);
    expect(out).toContain('"msg":"unhandled"');
  });
});
