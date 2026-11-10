# Security

Status: COMPLETED (review). No control was changed or weakened. One route was added (`PATCH
/me/queue`) under the same authentication, body limit, validation and compare-and-set as the `PUT`
beside it.

Verified by reading the code at the paths given. This is a code review, not a penetration test.

## 1. Controls reviewed

| Control | Where | Finding |
|---|---|---|
| Passwords | `src/server/auth/password.ts` | argon2id (Node's own), PHC string, constant-time compare |
| Sessions and device tokens | `src/server/auth/sessions.ts` | 32 random bytes; only a SHA-256 hash is stored |
| Login limits | `src/server/auth/ratelimit.ts` | per IP 10 a minute, 100 a day; per account, lock after 5 failures, 15 min doubling to 24 h |
| API budget | same | 50 burst, 10/s per user; streams and covers outside it |
| CSRF | `src/server/http.ts` | Origin check on unsafe methods with a cookie; bearer-token clients carry nothing ambient |
| Headers | `src/server/http.ts` | CSP, `nosniff`, `no-referrer`, COOP, HSTS when a public origin is set |
| Body size | `src/server/http.ts` (`BODY_LIMIT`) | 64 KB |
| Secrets at rest | `src/server/crypto.ts` | AES-256-GCM, fresh nonce, AAD `table\|row\|column`; master key from a file, never in the database; HKDF subkeys per purpose |
| SSRF | `src/server/navidrome/url.ts` | non-default URLs must be https and resolve only to public addresses; the resolved address is pinned for the requests that follow |
| Subsonic proxy | `src/server/navidrome/routes.ts` | method allow-list; a caller cannot set auth or protocol parameters (`RESERVED` in `client.ts`) |
| Signed stream URLs | `src/server/navidrome/routes.ts` | HMAC with its own subkey over account, song, expiry (6 h); `timingSafeEqual` |
| Isolation between users | `src/server/isolation.test.ts` | a test that fails when any route is not shown to be isolated |
| Windows token scope | `Windows/App/Api/Api.cs` (`GetStream`) | the device token is sent to the ECHO host only |

## 2. Dependencies

`pnpm audit --prod` (run 2026-11-10): no known vulnerabilities. `pnpm outdated`: patch and minor
versions only (hono, @hono/node-server, vite, vitest, react, biome, youtubei.js). None was upgraded:
no fix in them was needed, and an upgrade is its own change with its own test run.

## 3. The changes in this audit, seen from security

- **Retries** (`api()`, `Api.Send`, Android `Api.call`, Linux `Api::get`): reads only. A write is never repeated, so nothing can be
  applied twice. A 401 is never retried. At most two extra requests per failed read, with backoff,
  so a client cannot hammer a struggling server; a 429 waits for the server's `retry-after`.
- **Idle timeout** (`client.ts`): a stream can now stay open while its listener is paused. This is
  bounded by what was already true: the listener must be signed in, streams close when the listener
  disconnects (tested), and a silent upstream still times out. A signed-in user could always hold
  connections open by reading slowly; the fix does not create that.
- **`PATCH /me/queue`**: `requireUser`; validates `positionMs` as a number ≥ 0; updates only the
  caller's row (`WHERE user_id = ?`); isolation test extended.

## 4. Notes, no action taken

- The login limiter and API budget are in memory: a restart clears them. The file says so and why
  it is acceptable (an attacker cannot cause a restart).
- Transport security between ECHO and a Navidrome on the same host is plain HTTP on the default
  internal URL. Expected for a loopback or Docker-network hop. **Assumption:** that production uses
  such a URL; its configuration was not read (see [PERFORMANCE.md](PERFORMANCE.md) §3).
