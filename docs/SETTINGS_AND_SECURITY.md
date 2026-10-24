# ECHO — Settings & Security

Status: **Draft 2** (revised for a public, multi-user deployment, 2026-10-22) · Last reviewed 2026-10-22
Related: [Technical architecture](TECHNICAL_ARCHITECTURE.md) §2, §5.5, §6 (deployment, DB, API) · [Playback](PLAYBACK_ARCHITECTURE.md) §4.2, §5.2 · [Lyrics integration](LYRICS_INTEGRATION.md) §2

ECHO runs on a home server (Docker Compose, behind Caddy) and is **reachable from the public
internet**. It has a small number of users: the owner (admin) and possibly a few invited people.

---

## 1. Threat model

| Threat | Example | Primary controls |
|---|---|---|
| Credential stuffing / brute force | Bots hammering `/auth/login` | Argon2id, rate limits + lockout, mandatory TOTP for admin, optional TOTP for users (§4) |
| Session theft | Stolen cookie or device token | `__Host-` Secure HttpOnly cookies, hashed session storage, revocation, short device-token reuse window, IP/agent change shown in Sessions (§4.5) |
| CSRF from other sites | A page POSTs to `echo.example.com` | `SameSite=Lax` + Origin check on unsafe methods for cookie auth (§5.3) |
| XSS / malicious lyric text | Lyrics containing `<script>` | All lyric and metadata text inserted with `textContent` only; strict CSP (§5.4) |
| Cross-user access | User B reads user A's Navidrome password or queue | Every query scoped by `userId`; isolation test suite (§2.3) |
| Secret disclosure at rest | DB file copied from a backup | AES-256-GCM encryption of every secret column with a master key stored separately (§3) |
| Secret disclosure in transit to the browser | Navidrome token in DevTools | Secrets never leave the server; the browser holds only short-lived Spotify access tokens (§3.1) |
| Secret disclosure via logs | Signed stream URL in an access log | Redaction (§9) |
| SSRF via the Navidrome URL field | A user sets the "Navidrome URL" to `http://169.254.169.254/` | URL allow-rules (§6.1) |
| Abusing ECHO as an open proxy | Requests for arbitrary Subsonic methods or hosts | Method allow-list; each user can reach only their own configured Navidrome URL |
| Spoofed client IP | Forged `X-Forwarded-For` defeats rate limits | Proxy headers trusted only from Caddy (§5.1) |
| Container escape impact | A dependency RCE | Non-root, read-only rootfs, `cap_drop: ALL`, no published ports (`TECHNICAL_ARCHITECTURE.md` §6.4) |
| Compromised UI dependency | Exfiltration from the browser | CSP, minimal dependencies, exact pins |

Out of scope: an attacker with root on the OptiPlex, and DDoS (handled, if at all, upstream of Caddy).

---

## 2. Roles, scopes and isolation

### 2.1 Roles

| Role | Can |
|---|---|
| **admin** (exactly one at setup; more can be promoted) | Everything a user can, plus: server settings (public origin display, Spotify Client ID, Spicy Lyrics key, gate switches), invite/disable/delete users, view the audit log, see per-user connection *status* (never secrets) |
| **user** | Own account (password, TOTP, sessions), own connections (Navidrome, Spotify), own settings, queue and lyric overrides |

### 2.2 What is per-user vs server-wide

| Per-user | Server-wide (admin) |
|---|---|
| Navidrome connection (own Navidrome account) | Default internal Navidrome URL (`ECHO_NAVIDROME_URL`) |
| Spotify connection (own Spotify account, own refresh token) | **Spotify app Client ID** (one app, owned by the admin) |
| Preferences, queue, lyric offsets and pins | **Spicy Lyrics secret key** |
| Sessions and devices, TOTP | Policy gates G1/G2 kill switches (`PLAYBACK_ARCHITECTURE.md` §4.6) |
| — | Shared caches: palettes, lyrics, Spotify-ID mappings |

### 2.3 Isolation rule

Every data-access function takes a `userId` (`forUser(userId).connections.get('navidrome')`). There
is no unscoped accessor for user-owned tables. The isolation test suite logs in as user B and calls
every route with user A's identifiers (queue, sessions, overrides, connections, streams through
signed URLs). Every call must fail (`ACCEPTANCE_CRITERIA.md` SEC-11).

---

## 3. Secrets and encryption at rest

### 3.1 Inventory

| Item | Scope | Stored | Reaches a client? |
|---|---|---|---|
| User password | user | Argon2id hash only | never |
| TOTP secret | user | encrypted | once, during setup (QR/otpauth URI) |
| Recovery codes | user | Argon2id hashes (low-cost params) | once, at generation |
| Session ids / device tokens | user | SHA-256 hashes | the token itself, once (cookie / response body) |
| Navidrome password or API key | user | encrypted (`connections.secret_enc`) | never |
| Spotify refresh token | user | encrypted | never |
| Spotify access token | user | server memory cache (≤ 1 h [C]) | **yes**, on request, for the SDK and Web API (`Cache-Control: no-store`, JS memory only) |
| PKCE verifier + state | user, transient | memory, 10 min TTL | never |
| Spotify Client ID | server | plain (public in PKCE) | yes |
| Spicy Lyrics secret key (`sl_sk_…`) | server | encrypted | never |
| Stream-URL signing key, cookie-signing key | server | derived from the master key (HKDF-SHA256, distinct `info` labels) | never |
| **Master key** | server | Docker secret file, **not** in the DB or the image | never |

### 3.2 Encryption scheme

- **Master key:** 32 random bytes (`openssl rand -base64 32 > secrets/echo_master_key`, `chmod 600`).
  It is read from `/run/secrets/echo_master_key` at start. Missing or wrong length → the server
  refuses to start.
- **Per-value encryption:** AES-256-GCM via `node:crypto`, a random 96-bit nonce per write, and
  **AAD** = `table|rowId|column`, so a ciphertext can't be moved to another row or column. Stored as
  `v1:<nonce>:<ciphertext+tag>` (base64url). A key id prefix allows rotation.
- **Rotation:** `docker compose exec echo /nodejs/bin/node src/server/admin-cli.ts rotate-master-key --new-key-file …` re-encrypts
  all values in one transaction, then the old key file is replaced.
- No secret is ever written to the cache directory, logs, or the client bundle. `.gitignore` covers
  `secrets/`, `.env*` and `*.local.*`. The repo runs **gitleaks** in pre-commit and CI.

---

## 4. Accounts and authentication

### 4.1 First start (admin creation)

1. On first start with an empty `users` table, the server prints a one-time setup URL to the
   container log: `https://echo.example.com/setup#<token>`. The token is 32 random bytes, has a
   **30 min TTL**, and is regenerated on each restart while no admin exists.
2. The setup page requires the token and creates the admin (username, password) **and enrols TOTP
   (mandatory)** before the account becomes active. It shows recovery codes once.
3. `/setup` returns 404 once an admin exists.

### 4.2 Invites

- The admin creates an invite (single use, 72 h TTL, optional pre-set username) and gets a link
  `https://echo.example.com/invite#<token>` to send out of band.
- The invitee sets a username and password. TOTP is offered but optional (the admin can make it
  mandatory for all users in server settings).
- Invite tokens are stored hashed.

### 4.3 Passwords

- Minimum **12 characters**, maximum 256, no composition rules (NIST SP 800-63B style). Rejected if
  in a bundled list of the 10,000 most common passwords.
- **Argon2id**, starting parameters `m = 64 MiB, t = 3, p = 1`. Measured on the OptiPlex (i7-3770) in M1 with `node:crypto`
  `argon2()`: **183 ms** median, so the starting parameters stand (`TECHNICAL_ARCHITECTURE.md` §2.3). Parameters are stored with each hash, so they can be raised
  later with rehash-on-login.
- A password change revokes all other sessions and device tokens.

### 4.4 Login and rate limiting

- `POST /auth/login { username, password }` → `{ totpRequired: true, challenge }` or a session. The
  TOTP step is `POST /auth/totp { challenge, code }`. The challenge is single-use with a 5 min TTL.
- **Rate limits** (in memory, keyed by client IP from trusted proxy headers, and by username):
  - per IP: 10 login attempts / minute, 100 / day;
  - per account: after 5 consecutive failures, lock for 15 min, doubling up to 24 h. The admin can
    unlock;
  - TOTP: 5 attempts per challenge.
- Failures return a generic "Username or password is incorrect" with equal timing for unknown users
  (a dummy hash is verified).
- Every login, failure, lockout, TOTP change and session revocation is written to `audit_log`.

### 4.5 TOTP

RFC 6238: HMAC-SHA1, 6 digits, 30 s step, ±1 step tolerance. The last accepted step is stored, so a
code can't be replayed. Implemented on `node:crypto` and tested against the RFC test vectors.
Enrolment shows a QR code (`otpauth://totp/ECHO:<user>?secret=…&issuer=ECHO`) and requires one valid
code to activate. **10 recovery codes** are shown once, hashed, and each is single-use. Disabling TOTP
requires the password plus a current code. The admin cannot disable their own TOTP.

### 4.6 Sessions and device tokens

| | Web session | Device token (future native clients) |
|---|---|---|
| Transport | Cookie `__Host-echo_session`: `Secure; HttpOnly; SameSite=Lax; Path=/` | `Authorization: Bearer echo_dt_<base64url 32 bytes>` |
| Created by | login (+ TOTP) | `POST /auth/device` with credentials + TOTP and a device name |
| Lifetime | 30 days, sliding; expires after 14 days idle | 180 days, sliding; 60 days idle |
| Storage | SHA-256 of the token | SHA-256 of the token |
| Visible in | Account → Sessions & devices (name, created, last seen, approximate location from IP prefix) | same |
| Revocation | per item, "sign out everywhere else", password change | same |

`SameSite=Lax`, not Strict, because the Spotify OAuth callback is a top-level cross-site navigation
that must arrive with the session cookie. Lax sends cookies on top-level GET navigations only. All
state-changing routes are non-GET and additionally Origin-checked (§5.3).

---

## 5. HTTP hardening

### 5.1 Behind Caddy

- TLS terminates at Caddy (automatic certificates). ECHO listens on `8080` inside the compose
  network only.
- `X-Forwarded-For` / `X-Forwarded-Proto` are honoured **only** when the connection comes from the
  configured trusted proxy (`ECHO_TRUSTED_PROXY`). Otherwise they are ignored and the socket address
  is used.
- ECHO refuses requests whose forwarded protocol is not `https` (except `/health` from the Docker
  network, for health checks).

### 5.2 Host check

`Host` (after proxy handling) must equal the host of `ECHO_PUBLIC_ORIGIN`. Otherwise `421`. This
blocks DNS-rebinding and misrouted traffic.

### 5.3 CSRF and CORS

- Cookie-authenticated **unsafe methods** (POST/PUT/PATCH/DELETE) require `Origin` ==
  `ECHO_PUBLIC_ORIGIN`. Otherwise 403.
- Bearer-authenticated requests (native clients) are exempt from the Origin check. Bearer tokens
  aren't sent ambiently, so CSRF does not apply.
- `POST /auth/device` with **no Cookie and no Origin header** is exempt too (M8): that is a native
  client getting its token, with nothing ambient a forged request could carry. Browsers always send
  Origin on POST, so a cross-site form still meets the check.
- **No CORS headers.** Native clients aren't browsers and don't need them. Third-party web origins are
  not supported.

### 5.4 Response headers

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://sdk.scdn.co;
  frame-src https://sdk.scdn.co;
  connect-src 'self' https://api.spotify.com;
  img-src 'self' https://i.scdn.co data: blob:;
  media-src 'self' blob:;
  font-src 'self';
  style-src 'self';
  worker-src 'self' blob:;
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'self' https://accounts.spotify.com
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), display-capture=()
```

- Styles are set via the CSSOM (`element.style`), which `style-src` doesn't block. There are no inline
  scripts or styles.
- The Spotify SDK loads its script and one iframe from `sdk.scdn.co` (verified in M7 from the
  script itself); the iframe's own requests fall under its origin's policy, not ECHO's. CSP
  violation reports (`report-uri /api/v1/csp-report`, M8) showed none across the full E2E run.
- `Permissions-Policy` denies `display-capture` and `microphone`, a structural guarantee that ECHO
  never captures audio (`VISUALIZER_SPEC.md` §2.3).

### 5.5 Unauthenticated surface (complete list)

Static assets · `GET /health` · `GET /session` (signed in or not, and whether setup is open; M5) · `POST /auth/login` · `POST /auth/totp` · `POST /auth/device` ·
`GET /setup` + `POST /setup` (only while no admin exists) · `GET /invite` + `POST /invite` +
`POST /invite/totp` (a valid unused invite token; M8) · `POST /csp-report` (browser CSP reports, logged
only, 10 a minute per address and 300 in all; M8) ·
`GET /spotify/callback` (bound to an existing PKCE `state` and the session cookie) · signed stream
URLs (`TECHNICAL_ARCHITECTURE.md` §6.5). Everything else → `401`.

### 5.6 Limits

Request bodies ≤ 64 KB (no uploads in MVP). Per-user API rate limit: 50 req/s burst, 600/min (streams
and covers excluded). Lyric and palette routes are server-cached, so they can't amplify outbound
traffic beyond one upstream call per key and TTL.

---

## 6. Connection flows

### 6.1 Navidrome (per user)

```
Account → Connections → Navidrome
  URL (prefilled with ECHO_NAVIDROME_URL, e.g. http://navidrome:4533), username, password | API key
  → POST /api/v1/me/connections/navidrome
server: validate URL (rules below) → test (PLAYBACK_ARCHITECTURE.md §5.3)
  ├─ success → encrypt secret → store → 200 { serverInfo }
  └─ failure → nothing stored → 4xx { code, userMessage }
```

- **URL rules (SSRF):** the default internal URL is always allowed. Any other URL must be `https://`
  and resolve to a **public** address, unless the admin adds it to an allow-list in server settings.
  Link-local, loopback, metadata and private ranges are rejected for non-admins. The resolved IP is
  pinned for the request to prevent DNS rebinding.
- Each user uses **their own Navidrome account**, so Navidrome's own per-user libraries, playlists,
  stars and scrobbles stay correct.
- Secret fields are write-only in the UI ("•••••••• Saved").

### 6.2 Spotify

**Admin, once:**
1. Create a Spotify app in the Developer Dashboard (owner: the admin, who must have Premium [C]).
   Select Web Playback SDK and Web API.
2. Redirect URI: `https://echo.example.com/api/v1/spotify/callback` (HTTPS is required off-loopback
   [C]).
3. Enter the Client ID in Admin → Server → Spotify.
4. In Development Mode, the app allows **at most 5 Spotify users** [C]. Admin → Users shows "Spotify
   seats: n / 5". The admin adds each user's Spotify account email under the app's User Management.

**Each user:**
1. Account → Connections → Spotify → Connect. `GET /api/v1/spotify/login` creates `code_verifier`
   (64 random bytes), the S256 challenge and `state` (32 bytes), bound to the user's session, with a
   10 min TTL. It redirects to `accounts.spotify.com/authorize` with the scopes in
   `PLAYBACK_ARCHITECTURE.md` §4.2.
2. `GET /api/v1/spotify/callback?code&state`: validate `state` (single use, constant-time, must
   belong to the current session's user), exchange the code with `code_verifier` and no client
   secret [C], encrypt and store the refresh token, and keep the access token in memory.
3. `POST /api/v1/spotify/token` returns `{ accessToken, expiresAt }`, refreshing when < 5 min
   remain. A refresh response without a new refresh token keeps the old one [C]. Refresh tokens last
   ~6 months [C]; `invalid_grant` → "Sign-in expired" + Reconnect.
4. A 403 from Spotify for a user missing from the app's user list → "Ask the ECHO admin to add your
   Spotify account to the app."

### 6.3 Spicy Lyrics (admin)

Admin → Server → Lyrics → Spicy Lyrics key. The server validates the `sl_sk_` prefix and runs a test
lookup, then stores the key encrypted. Publishable keys are rejected with an explanation. The key is
used only server-side (`LYRICS_INTEGRATION.md` §2). The terms summary (attribution, 30-day cache, no
redistribution) is shown next to the field.

---

## 7. Settings model

### 7.1 Per-user preferences (`user_settings.json`, schema `version: 2`)

| Section | Key | Values | Default |
|---|---|---|---|
| Playback | `playback.defaultProvider` | `navidrome` \| `spotify` | first connected |
| | `playback.crossfadeSec` | 0–8 | 0 |
| | `playback.replayGain` | `off` \| `track` \| `album` \| `auto` | `auto` |
| | `playback.quality` | `auto` \| `raw` \| `320` \| `192` \| `128` | `auto` (`TECHNICAL_ARCHITECTURE.md` §6.5) |
| | `playback.scrobble` | bool | true |
| Lyrics | `lyrics.sizeScale` | 0.85 \| 1 \| 1.15 \| 1.3 | 1 |
| | `lyrics.globalOffsetMs` | −2000…2000 step 50 | 0 |
| | `lyrics.showUnsynced` | bool | true |
| | `lyrics.announceLines` | bool | false |
| | `lyrics.useSpotifyForLookup` | bool | false (`LYRICS_INTEGRATION.md` §4.3) |
| Visuals | `visuals.mode` | `auto` \| `reverb` \| `ambient` \| `still` | `auto` |
| | `visuals.intensity` | `subtle` \| `balanced` \| `expressive` | **`expressive`** (`VISUALIZER_SPEC.md` §7.4) |
| | `visuals.quality` | `auto` \| `high` \| `balanced` \| `low` \| `minimal` | `auto` (**per device**, stored client-side because devices differ) |
| | `visuals.motion` | `system` \| `full` \| `reduced` \| `off` | `system` |
| | `visuals.grain` | bool | false |
| | `visuals.pointerParallax` | bool | true |

`visuals.quality` and `playback.quality` are stored in `localStorage` per device. A gaming PC and a
laptop need different values. Everything else follows the user across devices.

### 7.2 Server settings (admin)

| Key | Default |
|---|---|
| `spotify.clientId` | null |
| `spotify.gates.artPalette` (G1) | **true** (owner decision 2026-10-22) |
| `spotify.gates.syncedLyrics` (G2) | **true** (owner decision 2026-10-22) |
| `lyrics.spicyKey` (secret), `lyrics.spicyEnabled`, `lyrics.lrclibEnabled` | —, true, true |
| `auth.requireTotpForAll` | false (admin always required) |
| `navidrome.extraAllowedUrls` | [] |

### 7.3 Settings screens

Settings → **Playback · Lyrics · Visuals · Keyboard · About** (per-user preferences);
**Account** → Profile, Password, Two-factor, Sessions & devices, Connections (Navidrome, Spotify);
**Admin** (admins only) → Server, Users & invites, Audit log. Each view has one save model:
self-saving controls with a "Saved" stamp (taste-skill app rules §8.2).

---

## 8. Connection testing and status rows

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ Navidrome      ● Connected                                                [Test] [Disconnect] │
│                navidrome:4533 · Navidrome 0.64.2 · 41,203 tracks · synced lyrics              │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ Spotify        ● Sign-in expired                                              [Reconnect]   │
│                Premium · device "ECHO" · seat 2 of 5                                          │
└───────────────────────────────────────────────────────────────────────────────────────────┘
Admin → Server:
│ Spicy Lyrics   ● Connected · key ending …7f2a · rate limit OK                [Test] [Remove] │
│ LRCLIB         ● Reachable                                                                  │
│ Spotify app    Client ID 3f9a…c21 · 2 of 5 seats used                        [Edit]          │
```

| Item | Test does | Statuses |
|---|---|---|
| Navidrome (user) | ping + extensions + scan status | Connected · Unreachable · Credentials rejected · TLS error · Not a Subsonic server · URL not allowed |
| Spotify (user) | refresh + `GET /v1/me` + Widevine probe (in this browser) + SDK `ready` | Connected · Sign-in expired · Premium required · Not on the app's user list · This browser can't play protected audio |
| Spicy Lyrics (admin) | lookup of a fixed track ID | Connected · Key rejected · Rate limited (until hh:mm) · Unreachable |
| LRCLIB (admin) | fixed lookup | Reachable · Unreachable |

Tests time out at 8 s and name the step that failed.

---

## 9. Logging and redaction

- JSON logs to stdout. A central redactor runs on every record:
  - exact-match replacement of every currently loaded secret (Navidrome secrets of active users,
    tokens, the Spicy key);
  - query params `u, p, t, s, apiKey, token, code, code_verifier, state, sig, refresh_token,
    access_token` → `«redacted»`;
  - headers `authorization, cookie, set-cookie` → `«redacted»`;
  - bodies of `/auth/*`, `/setup`, `/invites/*`, `/me/password`, `/me/totp/*`,
    `/me/connections/*`, `/admin/settings` are never logged.
- Access logs record user id, route template (`/api/v1/navidrome/stream/:id`), status and duration.
  They never record raw query strings.
- Caddy's own access log must not capture query strings for `/api/v1/navidrome/stream/*` (signed
  URLs). `Caddyfile.example` includes a log filter for that.
- **Test (SEC-04):** every secret type through every log path, with no substring present.

---

## 10. Disconnecting and account lifecycle

| Action | Effect |
|---|---|
| Disconnect Navidrome (user) | Confirm (names the server). Stops Navidrome playback for this user, clears their Navidrome queue, deletes the connection row (secret included), and drops client caches. Shared caches (palette, lyrics) stay, because they contain no user data. |
| Disconnect Spotify (user) | Confirm. `player.disconnect()` in open clients (via the next token request failing), deletes the refresh token, and evicts the in-memory access token. The dialog notes: "To remove ECHO's access completely, also remove it in your Spotify account's Apps page" (Spotify's Web API offers no token revocation endpoint [C]). Frees a Spotify seat. As built (M8),
  Disconnect deletes the row at once; the dialog note is a follow-up. |
| Revoke a session or device | Immediate. The next request with it gets 401. |
| Delete my account | A confirm dialog + password + TOTP (or a recovery code). Deletes the user, sessions, connections (with their ciphertext), settings, queue, overrides, recovery codes, invites they created, and their audit rows; one anonymous `account.deleted` line remains (M8). The last admin cannot delete themselves. |
| Admin disables a user | Revokes all their sessions. Login is refused. Data is kept. |
| Admin deletes a user | As "delete my account" |
| Remove the Spicy key (admin) | Deletes the key and purges all Spicy cache entries |
| Reset server (admin, CLI only) | `echo-admin reset --yes-delete-everything`: deletes the DB and caches. The master key file is left for the operator to remove |

A test asserts that after each disconnect or deletion no row or ciphertext for that user or
connection remains (SEC-06).

---

## 11. Backups and key management

- Back up the database with `docker compose exec echo /nodejs/bin/node src/server/admin-cli.ts backup` (a consistent online
  copy, `VACUUM INTO`, written to `/data/backups/echo-<time>.db`), and copy that file out with the
  owner's normal backups. The cache can be skipped.
- Back up `secrets/echo_master_key` **separately** (password manager or offline). A DB backup
  without the key exposes no secrets.
- **Restore:** put the backup in place as `/data/echo.db` on a fresh container with the same
  master key; `admin-cli.ts verify` reports how many sealed values open. Without the key (verified
  in the M8 drill, `src/server/admin-cli.test.ts`): passwords, sessions, settings and queues work;
  Navidrome and Spotify connections show "needs re-entry"; TOTP secrets are unreadable, so users
  sign in with a recovery code and enrol again; the admin re-enters the Spicy key.
- **Rotation:** `admin-cli.ts rotate-master-key --new-key-file <file>` re-seals every secret with
  the new key in one transaction; then replace the `echo_master_key` secret with that file and
  restart at once.

---

## 12. Supply chain and container

- `pnpm`, committed lockfile, exact versions. Build scripts allowed only for `better-sqlite3` and
  `sharp` (`allowBuilds` + `strictDepBuilds` in `pnpm-workspace.yaml`; pnpm 12 renamed
  `onlyBuiltDependencies`). Argon2 is built into Node, so `@node-rs/argon2` is not a dependency.
  New versions must be ≥ 14 days old (`minimumReleaseAge`).
- Base images pinned by digest. Build: `node:24.22.0-trixie` (Debian 13). Runtime (since M9):
  **`gcr.io/distroless/nodejs24-debian13`**, with no shell, package manager, util-linux, ncurses or
  perl. This removed every HIGH finding of the former `node:24.22.0-trixie-slim` runtime, and SEC-10
  passed strictly at the M9 re-check (`docs/reviews/M9.md`). Rebuilt monthly or on Node security releases. Image scan (Trivy) in CI;
  high or critical findings fail the build. CI applies this to **fixable** findings
  (`--ignore-unfixed`). Unfixed findings are reported separately, and any remaining ones need an
  explicit, owner-accepted, time-boxed exception recorded in the milestone review (SEC-10). A
  second CI step checks all findings against the current exception
  (`docs/reviews/M1-SEC-10-exception.md`, retired at M9 with no findings left) and fails on anything outside it. An exception
  never counts as a pass. Each monthly rebuild reassesses it.
- `pnpm audit --prod` and gitleaks in CI.
- The container runs as uid 1000 with a read-only root filesystem, `/tmp` tmpfs, `cap_drop: ALL`,
  `no-new-privileges`, and no published ports.
- New dependencies must be justified in `TECHNICAL_ARCHITECTURE.md` §3 before being added.
