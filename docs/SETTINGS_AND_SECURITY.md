# ECHO — Settings & Security

> **Navidrome only since 2026-11-03.** Spotify was removed (`824eeb9`, `8f2c1b2`; why:
> [reviews/2026-11-03-spotify-outage.md](reviews/2026-11-03-spotify-outage.md)). A migration
> deleted its stored connections and app credentials. Removed sections are one-line stubs so
> section numbers stay put; their full text is in git before those commits.

Status: **Draft 2** (revised for a public, multi-user deployment, 2026-10-22) · Last reviewed 2026-10-24 against the build (M1–M9); "As built" notes mark where it differs
Related: [Technical architecture](TECHNICAL_ARCHITECTURE.md) §2, §5.5, §6 (deployment, DB, API) · [Playback](PLAYBACK_ARCHITECTURE.md) §5.2 · [Lyrics integration](LYRICS_INTEGRATION.md) §2

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
| Secret disclosure in transit to the browser | Navidrome token in DevTools | Secrets never leave the server; the browser holds none (§3.1) |
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
| **admin** (exactly one at setup; more can be promoted) | Everything a user can, plus: server settings (public origin display, Spicy Lyrics key, library matching, the TOTP policy), invite/disable/delete users, view the audit log, see per-user connection *status* (never secrets) |
| **user** | Own account (password, TOTP, sessions), own Navidrome connection, own settings, queue and lyric overrides |

### 2.2 What is per-user vs server-wide

| Per-user | Server-wide (admin) |
|---|---|
| Navidrome connection (own Navidrome account) | Default internal Navidrome URL (`ECHO_NAVIDROME_URL`) |
| Preferences, queue, lyric offsets and pins | **Spicy Lyrics secret key** |
| Sessions and devices, TOTP | Library matching for Spicy Lyrics (`LYRICS_INTEGRATION.md` §4.3) |
| — | Shared caches: palettes, lyrics, Spotify-id matches |
| — | The Wanted list: one for everyone, by the owner's choice (2026-11-03); see §2.3 |

### 2.3 Isolation rule

Every data-access function takes a `userId` (`forUser(userId).connections.get('navidrome')`). There
is no unscoped accessor for user-owned tables. The isolation test suite logs in as user B and calls
every route with user A's identifiers (queue, sessions, overrides, connections, streams through
signed URLs). Every call must fail (`ACCEPTANCE_CRITERIA.md` SEC-11).

Shared by design, and listed as such in that suite: the lyrics cache (its per-user overrides are
attacked) and the **Wanted list** (`/wanted`: everyone reads, adds and removes). For the list, only
the server's own library marks items found: the default Navidrome (`ECHO_NAVIDROME_URL`), else the
first admin's. A user connected to another server never fills it, and nobody's text is searched
with another user's credentials (security review, 2026-11-03). Each user adds at most 200 items.

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
| YouTube Music cookie (the pasted `Cookie` header) | user | encrypted (`youtube_accounts.cookie_enc`, re-sealed by `rotate-master-key`) | never; sent only to YouTube's own hosts, never to yt-dlp |
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

`SameSite=Lax`, not Strict: a link into ECHO from elsewhere (a bookmark, a link in a chat) is a
top-level cross-site navigation and should arrive signed in. Lax sends cookies on top-level GET
navigations only. All
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
  script-src 'self';
  frame-src 'none';
  connect-src 'self';
  img-src 'self' data: blob:;
  media-src 'self' blob:;
  font-src 'self';
  style-src 'self';
  worker-src 'self' blob:;
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'self';
  report-uri /api/v1/csp-report          (M8: violations are logged)
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), display-capture=()
```

- Styles are set via the CSSOM (`element.style`), which `style-src` doesn't block. There are no inline
  scripts or styles.
- Nothing third-party loads: no script, frame, connection or image from another origin (the Spotify
  SDK's `sdk.scdn.co` and Spotify's API and covers went with Spotify, 2026-11-03). CSP violation
  reports (`report-uri /api/v1/csp-report`, M8) showed none across the full E2E run.
- `Permissions-Policy` denies `display-capture` and `microphone`, a structural guarantee that ECHO
  never captures audio (`VISUALIZER_SPEC.md` §2.3).

### 5.5 Unauthenticated surface (complete list)

Static assets · `GET /health` · `GET /session` (signed in or not, and whether setup is open; M5) · `POST /auth/login` · `POST /auth/totp` · `POST /auth/device` ·
`GET /setup` + `POST /setup` (only while no admin exists) · `GET /invite` + `POST /invite` +
`POST /invite/totp` (a valid unused invite token; M8) · `POST /csp-report` (browser CSP reports, logged
only, 10 a minute per address and 300 in all; M8) ·
signed stream
URLs (`TECHNICAL_ARCHITECTURE.md` §6.5). Everything else → `401`.

### 5.6 Limits

Request bodies ≤ 64 KB (no uploads in MVP). Per-user API rate limit: 50 req/s burst, 600/min (streams,
covers and YouTube thumbnails excluded). Lyric and palette routes are server-cached, so they can't amplify outbound
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

### 6.2 Spotify (removed)

Removed on 2026-11-03: the admin's Spotify app, each user's PKCE connection, and the 5-seat limit.

### 6.2a YouTube Music (per user; 2026-11-03)

Settings → Account → YouTube Music: the user pastes the `Cookie` request header of a signed-in
music.youtube.com tab (Google offers no sign-in for this). The server stores it only once an
authenticated call answers with the account's name, sealed, and never returns it. It is used for
browsing (InnerTube, through youtubei.js) and never for audio: yt-dlp fetches every song
anonymously, because its documentation warns that accounts used with it get banned. Each user's
browsing session is cached per stored sealed value, so a reused user id never inherits another's
sign-in. A cookie Google rotated answers 409 `youtube.signed_out` (`stale: true`) and the client asks
to sign in again; 401 stays reserved for the ECHO session.

Audio: `/youtube/stream/:id` resolves the song with yt-dlp (at most two at once, cached until 30 min
before the URL's expiry) and proxies it: googlevideo URLs are bound to the server's IP and refuse
other User-Agents, so the bytes pass through ECHO with yt-dlp's own headers, the browser's Range
translated into googlevideo's `range` parameter (at most 10 MiB per answer), sandboxed and
`no-store`. Thumbnails pass through `/youtube/image`, https on YouTube's image hosts only, no
redirects, raster types only, so the CSP keeps `img-src 'self'`. The yt-dlp binary is copied from
the image into `/data/bin` and updated daily with `yt-dlp -U` (which checks the release's
checksums); its temporary files and cache live in `/data`.

Per device, in `localStorage` (not settings): which world the device is in (`echo.mode`) and
YouTube Music mode's edition (`echo.ytEdition`: day or night; absent, the device's dark setting
decides).

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
| Playback | `playback.crossfadeSec` | 0–8 | 0 |
| | `playback.replayGain` | `off` \| `track` \| `album` \| `auto` | `auto` |
| | `playback.quality` | `auto` \| `raw` \| `320` \| `192` \| `128` | `auto` (`TECHNICAL_ARCHITECTURE.md` §6.5) |
| | `playback.scrobble` | bool | true |
| Lyrics | `lyrics.sizeScale` | 0.85 \| 1 \| 1.15 \| 1.3 | 1 |
| | `lyrics.globalOffsetMs` | −2000…2000 step 50 | 0 |
| | `lyrics.showUnsynced` | bool | true |
| | `lyrics.announceLines` | bool | false |
| | `lyrics.disabledSources` | subset of the lyric sources | none (Settings → Lyrics → Lyric sources) |
| Visuals | `visuals.mode` | `auto` \| `reverb` \| `ambient` \| `still` | `auto` |
| | `visuals.intensity` | `subtle` \| `balanced` \| `expressive` | **`expressive`** (`VISUALIZER_SPEC.md` §7.4) |
| | `visuals.quality` | `auto` \| `high` \| `balanced` \| `low` \| `minimal` | `auto` (**per device**, stored client-side because devices differ) |
| | `visuals.motion` | `system` \| `full` \| `reduced` \| `off` | `system` |
| | `visuals.grain` | bool | false |
| | `visuals.pointerParallax` | bool | true |
| | `visuals.backdrop` | 0–1, the blurred cover's brightness (the Stage's brightness control, 2026-10-28) | 0.5 (**per device**) |
| | `visuals.performance` | bool: Performance mode, for a slow computer (2026-11-04) | false (**per device**) |

`visuals.quality`, `visuals.backdrop`, `visuals.performance`, `playback.quality` and the volume are
stored in `localStorage` per device. A gaming PC and a laptop need different values, and screens
differ in brightness. Everything else follows the user across devices.

Performance mode (`effectiveVisuals`, `src/client/prefs.ts`) applies over the saved choices without
changing them: motion becomes `reduced` (smaller animations in Navidrome and YouTube Music mode
alike, which also holds the Listen room still) unless `off` was chosen, and the quality `minimal`.
The lyrics keep moving word by word (owner, 2026-11-04). Measured on a 4×-throttled Chromium at
1366×768: Listen with lyrics playing went from 7 to 60 fps (main thread 102% → 26% busy), page
changes from 40 to 57 fps; pages that were already smooth stayed so. While it is on, Settings shows
the Stage visuals, intensity, motion and quality it decides as set by it.

### 7.2 Server settings (admin)

| Key | Default |
|---|---|
| `spotify.matchLibrary` (match the library with Spotify track ids for Spicy Lyrics) | true |
| `lyrics.spicyKey` (secret), `lyrics.spicyEnabled`, `lyrics.lrclibEnabled` | —, true, true |
| `auth.requireTotpForAll` | false (admin always required) |
| `navidrome.extraAllowedUrls` | [] |
| `youtube.enabled` (YouTube Music mode for everyone; off answers 404 `youtube.disabled` on `/youtube/*`) | true |

### 7.3 Settings screens

Settings → **Playback · Lyrics · Visuals · Keyboard · About** (per-user preferences);
**Account** → Profile, Password, Two-factor, Sessions & devices, Connections (Navidrome);
**Admin** (admins only) → Server, Users & invites, Audit log. Each view has one save model:
self-saving controls with a "Saved" stamp (taste-skill app rules §8.2).

As built (M8): three tabs, Preferences · Account · Admin, with the five preference groups on one
page; `src/client/shell/SettingsViews.tsx`, `AccountViews.tsx`, `AdminViews.tsx`.

---

## 8. Connection testing and status rows

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ Navidrome      ● Connected                                                [Test] [Disconnect] │
│                navidrome:4533 · Navidrome 0.64.2 · 41,203 tracks · synced lyrics              │
└───────────────────────────────────────────────────────────────────────────────────────────┘
Admin → Server:
│ Spicy Lyrics   ● Connected · key ending …7f2a · rate limit OK                [Test] [Remove] │
│ LRCLIB         ● Reachable                                                                  │
```

| Item | Test does | Statuses |
|---|---|---|
| Navidrome (user) | ping + extensions + scan status | Connected · Unreachable · Credentials rejected · TLS error · Not a Subsonic server · URL not allowed |
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
  Navidrome connections show "needs re-entry"; TOTP secrets are unreadable, so users
  sign in with a recovery code and enrol again; the admin re-enters the Spicy key.
- **Forgotten password:** `admin-cli.ts reset-password <username>`, for whoever holds the master
  key: it refuses unless the key opens this server's sealed values, sets a generated password
  (24 characters, shown once, never typed into a shell), signs the account out on every device and
  writes `account.password_reset` to the audit log. TOTP is untouched: signing in still needs the
  code (or a recovery code). The user then picks their own in Settings → Account → Password.
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
