# M8 pre-share security review (SEC-19)

Scope: `IMPLEMENTATION_PLAN.md` M8 task 11; `SETTINGS_AND_SECURITY.md` §1 walked threat by threat.
Date: 2026-10-24.

**Status: the code-side and local review is done. The live half needs the deployed instance
(M5 task 12, waiting for the owner's go-ahead). SEC-19 is not passed until that half is done, and
the domain must not be shared with anyone else before then.**

## How it was checked

- **Code and tests:** the unit suite (1190+ tests) and E2E suite (368 tests in Chromium, Firefox
  and the isolated project). The suites named below are the evidence.
- **Local production-mode server:** `ECHO_PUBLIC_ORIGIN=https://echo.example.com`,
  `ECHO_TRUSTED_PROXY=127.0.0.1`, behind curl acting as Caddy (`X-Forwarded-Proto: https`). It
  checked headers, Host and https enforcement, the unauthenticated surface, the login rate limit,
  the cross-site POST refusal and the access log.
- **Dependencies:** `pnpm audit --prod`: no known vulnerabilities. Exact pins, two-week minimum
  release age, and install scripts only for `better-sqlite3` and `sharp` (`pnpm-workspace.yaml`).

## Threat by threat

| Threat (§1) | Control | Evidence | State |
|---|---|---|---|
| Credential stuffing / brute force | Argon2id; 10/min and 100/day per IP; account lockout 15 min doubling; TOTP mandatory for admins; **re-authentication on Account routes counts like logins** (fixed in M8) | `auth/routes.test.ts`, `account.test.ts` (re-auth lockout); live: 10 × 401 then 429 | ✅ |
| Session theft | `__Host-echo_session`, Secure, HttpOnly, SameSite=Lax, Path=/; stored as SHA-256; sliding 30 d / 14 d idle (web), 180 d / 60 d idle (device); revoke one, revoke others, password change revokes others; lockout signs out everywhere | `auth/routes.test.ts` (cookie flags, idle), `account.test.ts` (SEC-14, device expiry), `settings.spec.ts` | ✅ |
| CSRF | SameSite=Lax + Origin check on unsafe cookie requests; bearer exempt; native device login exempt only without Cookie and Origin | `http.test.ts`; live: foreign Origin → 403 | ✅ |
| XSS / malicious lyric text | React text nodes and `textContent` only; no `innerHTML`/`dangerouslySetInnerHTML`/`eval` in the client (scanned); attribution links http(s) only (fixed in M6); strict CSP with `report-uri`; **no CSP violation during the full E2E run** | `csp.spec.ts` (SEC-08), `sources.test.ts`, code scan | ✅ |
| Cross-user access | Every query scoped by the session user; the isolation suite attacks every route with another user's identifiers and fails if a new route is left out | `isolation.test.ts` (SEC-11) | ✅ |
| Secret disclosure at rest | AES-256-GCM per value with AAD; master key a Docker secret; restore without the key leaves secrets unreadable and the app working; rotation command | `crypto.test.ts`, `admin-cli.test.ts` (DEP-03 drill), `secrets.spec.ts` (raw DB grep) | ✅ |
| Secret disclosure to the browser | Only the short-lived Spotify access token reaches the browser; bundle, storage and every API body of a session scanned | `secrets.spec.ts` (SEC-03), `spotify.test.ts` | ✅ |
| Secret disclosure via logs | Central redactor (decrypted secrets word for word, in raw, JSON-escaped and URL-encoded forms; secret params; credential headers; token shapes); access lines carry route templates only; errors through the redactor; Caddy log filter drops query strings | `log.test.ts` (SEC-04), `Caddyfile.example` | ✅ (Caddy filter: live check) |
| SSRF via the Navidrome URL | https + public address, IPv6 allowlist of global unicast, pinned address, the default internal URL only from config | `navidrome/url.test.ts`, `routes.test.ts` | ✅ |
| Open proxy | Subsonic method allow-list; only the user's own configured server; mutating methods POST-only | `navidrome/routes.test.ts` | ✅ |
| Spoofed client IP | `X-Forwarded-*` only from `ECHO_TRUSTED_PROXY`; last hop | `http.test.ts` | ✅ |
| Container escape impact | uid 1000, read-only rootfs, `cap_drop: ALL`, no-new-privileges, no ports, digest-pinned bases | `compose.test.ts` (SEC-09 static) | ✅ static · ⏳ `docker inspect` |
| Compromised UI dependency | CSP, few dependencies, exact pins, release-age gate, audit clean | `pnpm audit`, `pnpm-workspace.yaml` | ✅ |

## Findings fixed during M8

The automated review flagged these, and each was fixed with a regression test that fails on the
old code:

1. Re-authentication (password, TOTP) on Account routes was not rate limited, so a stolen session
   could guess them (`3d5f886`).
2. The log redactor missed secrets whose JSON-escaped or URL-encoded form differed from the raw
   text (`21dad9e`).
3. An unreadable TOTP (after a restore without the key) could be replaced with the password alone.
   It now needs a recovery code too (`caefff9`).
4. CSP report rate limiting: an unbounded map first, then a global budget one source could
   exhaust. It is now per address in a bounded map, with a global backstop and a logged dropped
   count (`7be741f`, `df47e47`).

From M7, also in scope: Spotify-ID mappings and lyric cache keys carry the lookup basis
(`a81268f`).

## Live half (owner, after deployment)

Each item names its pass condition.

1. **TLS:** `testssl.sh https://<domain>`, grade **A or better**. Record the grade and any
   warnings here.
2. **Headers:** securityheaders.com (or `curl -sI`) on `/` and `/api/v1/health`. The response
   must match `SETTINGS_AND_SECURITY.md` §5.4, with HSTS present.
3. **Unauthenticated surface:** `curl` every §5.5 route without a cookie, plus a sample of others
   (`/api/v1/me`, `/api/v1/me/queue`, `/api/v1/admin/users`): only §5.5 answers, everything else
   401.
4. **Cookie flags** in the browser's DevTools after signing in: `__Host-echo_session`, Secure,
   HttpOnly, SameSite=Lax, Path=/.
5. **Rate limit:** 11 wrong logins from one address, and the 11th gets 429. Then unlock the
   account in Admin.
6. **Container:** `docker inspect echo` reports `User` `1000:1000`, `ReadonlyRootfs` true,
   `CapDrop` [ALL], `SecurityOpt` no-new-privileges, and no `PortBindings` (or loopback only, with
   Caddy on the host).
7. **Caddy log:** play a track, then check that the access log has no `sig=` and no query strings
   (`Caddyfile.example` filter).
8. **Backup drill on the box (DEP-03 M):** `docker compose exec echo /nodejs/bin/node
   src/server/admin-cli.ts backup`, restore into a fresh container with the key, and with a wrong
   key; `admin-cli.ts verify` reports as expected (the runtime is distroless since M9: no shell).

When all eight pass, SEC-19 passes and the domain may be shared.
