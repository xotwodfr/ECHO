# ECHO: Overnight engineering plan (2026-10-27 → 28)

Status: **living document**, updated as work lands. Author: Claude (autonomous overnight session).
Scope: find what ECHO actually needs fixed, then fix as much as can be done safely tonight.

**Evidence labels.** **[X]** exercised: a test, script or browser run did it tonight. **[S]** static:
I read the code path end to end and confirmed it, but did not run it. **[S·a]** static, reported by a
read-only audit agent and spot-checked by me at the cited lines (not run). **[D]** documentation
review. Nothing here claims a provider (Spotify, NetEase, Spicy, LRCLIB) or the live deployment was
exercised: the E2E suites use the repo's mocks (`src/server/navidrome/mock.ts`).

---

## 1. Executive summary

ECHO is much further along than the overnight brief assumed. The brief described "M2 through
task 7". In fact **M1–M9 are built and tested** and ECHO has been deployed at echo.folk3s.com since
2026-10-24 (104 commits). The tree was clean at the start: the `pnpm-workspace.yaml` change the brief
mentions was committed on 2026-10-24 (`30f918f`), so there was nothing to preserve or exclude.

The baseline was strong: typecheck, Biome, 1242/1242 Vitest, build, `pnpm audit --prod` and
gitleaks over all 104 commits were all clean. **But the E2E suite was not green.** One Firefox test
failed 20 runs out of 20, and that blocked the 15-test isolated project.

The audit found **no P0**. **What matters most:**

1. **Reverb loses its onset rings after the first track (P1, ON-VZ-1).** The analyser stamps onsets
   with *song* time, which resets on every track change. Its "time since the last onset" check then
   stays negative for about one track length. The signature visual goes quiet, and nothing tests it.
2. **Two Navidrome playback paths skip the wrong track (P1, ON-PB-1/2).**
   - Pressing Next twice quickly, or Pause before the audio starts, rejects the pending `play()` with
     `AbortError`. ECHO treats that as a broken stream and skips a track, with a toast.
   - A stream that fails before its metadata loads (a Navidrome restart) skips at once. The REL-02
     reload-and-retry never runs.
3. **A page load during a server restart leaves an empty, dead app (P1, ON-UI-1).** This happens on
   every redeploy behind Caddy. A failed `/session` is treated as the dev-only "offline" shell. There
   is no library and no player, Caddy's 502 raises no banner, and nothing recovers without a manual
   reload.
4. **Credential and data-integrity defects (P2):**
   - A spent invite becomes usable again once its invitee is deleted (ON-SEC-1).
   - User ids are reused, so a cached Spotify access token can reach the next user who gets the
     same id (ON-SEC-2).
   - A failed backup leaves a partial file that counts as that day's backup (ON-DB-1).
   - A disk-full error in a detached cache write crashes the server (ON-DB-2).
5. **Lyrics that are wrong without any error (P2, ON-LY-1…6):**
   - A transient outage is cached as "no lyrics" for 3 days.
   - An LRCLIB search failure becomes "not found".
   - NetEase text after a "(" is dropped.
   - A blank end-marker fails the timing check, so a correctly timed song loses its sync.
   - Arabic held words lose their letter joining.
   - A lyric offset can be saved to the wrong track.
6. **Errors shown as empty results (P2, ON-UI-2/3):**
   - An album that fails to load shows "0 tracks" (its error string exists but is never used).
   - With Spotify connected, failed playlists and search show "none" instead of an error with Retry.

Releases still need the owner, people or real devices (TLS grade, Spotify Premium checklist,
reference-client performance, Orca, the five-second test, the 8 h soak). None of that can be closed
tonight, and this plan does not claim it.

## 2. Actual project state (reconciled 2026-10-27 23:25)

| Brief said | Repository says | Evidence |
|---|---|---|
| M1 done, M2 through task 7, M2 criteria open | M1–M9 built; deployed 2026-10-24; MVP-β **not** reached (owner/people/device items) | `git log` (104 commits), `docs/reviews/M1…M9.md`, `ACCEPTANCE_CRITERIA.md` status table |
| Recent commits `9b5887c`, `91c0a7c`, `0600c4c` | They exist, at positions 94–96 of 104 (2026-10-23) | `git log --oneline` [X] |
| `pnpm-workspace.yaml` change left uncommitted | Committed in `30f918f` "Exclude pnpm 12.11.2 from the minimum release age" (2026-10-24). Working tree clean at start | `git status`, `git log -- pnpm-workspace.yaml` [X] |
| Taste-skill local patch | Documented in `~/.claude/skills/design-taste-frontend/LOCAL-PATCHES.md`; its check passes 3/3 (`plain` flagged, `unclipped-380` flagged, `clipped-inside` clear). Not modified tonight | `local-patches/edge-text/check.sh` [X] |
| Dev server may be running | None on 5173/18787/18788. The **live** `echo` container (127.0.0.1:3077, image built 22:58 from `21dc5f1`; `a2a1cb7` is not deployed) runs on this same box with Navidrome and other services. Left alone | `ss -ltnp`, `docker ps`, `docker image inspect` [X] |
| No remote | No remote by the owner's choice (2026-10-27). GitHub CI has never run; `scripts/e2e-container.sh` is the local CI equivalent | memory, `git remote -v` |

### Baseline checks on the starting tree (`a2a1cb7`)

| Check | Result |
|---|---|
| `pnpm typecheck` (TS 7.0.2) | pass [X] |
| `pnpm lint` (`biome ci`, 221 files) | pass [X] |
| `pnpm test` (Vitest) | **1242 passed / 0 failed**, 56 files [X] |
| `pnpm build` | pass; shell `index` 95.5 KB gzip, `engine` 153.8 KB gzip [X] |
| `pnpm audit --prod` | no known vulnerabilities [X] |
| gitleaks 8.30.1 over history | 104 commits, no leaks [X] |
| `pnpm test:e2e` (host) | **347 passed, 1 failed, 90 skipped, 15 did not run** [X]. Failure: `smoke.spec.ts:60` Firefox (ON-TST-1). The 15 are the `isolated` project, blocked by its dependency on that failure |
| `--project=isolated --no-deps` | 15 passed [X] |

## 3. Findings

Each finding lists: **priority** · **where** · **evidence** · **expected** · **fix** · **risk / deps** ·
**verify (pass condition)** · **tonight?** · **status**. Priorities: P0 critical, P1 high, P2 medium,
P3 low.

### 3.1 Security and credential handling

**ON-SEC-1 · P2 · A spent invite becomes valid again when its invitee is deleted.**
- Where: `src/server/db/db.ts:47` (`used_by … ON DELETE SET NULL`), `auth/routes.ts:128-131`
  (`INVITE_TTL_CHECK`: `used_by === null && expires_at > t`), and `account.ts:22` (`deleteUser`).
- Evidence [S]: when a user is deleted, `used_by` becomes NULL, and the token passes the check
  again until the invite's 72 h expiry. `account.test.ts` asserts that `used_by` is cleared. That
  assertion hides the problem.
- Expected: invites are single-use (SEC-14 / `SETTINGS_AND_SECURITY.md` §4.6).
- Fix: in `deleteUser`'s transaction, expire the invites the user redeemed (`expires_at = 0`) before
  deleting them.
- Verify: unit test. Redeem, delete the user, re-redeem → `invite_invalid`, and the invite is no
  longer listed as pending.
- Tonight: yes. Status: **fixed** (`00460cb`) [X]: the test failed first (the spent link made a new account, 200), then passes.

**ON-SEC-2 · P2 · User ids are reused, so in-memory and signed state reaches the next user.**
- Where: `db.ts:14` (`id INTEGER PRIMARY KEY`, no `AUTOINCREMENT`: deleting the newest user frees
  its id). `spotify.ts:209-211`: `accessToken()` returns `tokens.get(userId)` without checking that a
  connection exists. `navidrome/routes.ts:424`: signed stream URLs bind only `uid|id|exp`.
- Evidence [S]: the admin deletes the newest user X, who still has a live access token, and invites
  Y within the hour. Y's `POST /spotify/token` then returns X's token, with X's scopes. X's signed
  stream URLs (up to 6 h) also authenticate as Y.
- Expected: no cross-user disclosure (SEC-16 isolation).
- Fix: `accessToken` refuses without a connection row that has a secret (this also closes the
  disconnect-during-refresh race). Signed URLs also bind the user's `created_at`. Changing the id
  allocation would mean rebuilding the `users` table, a destructive migration, so it is left out.
- Risk: signed URLs already handed out stop working after the deploy. Clients re-sign, and the TTL is
  6 h.
- Verify: unit tests. A token is cached and its row is deleted → `not_connected`. A URL signed for
  `(id, created_at₁)` is refused once the id belongs to a user with a different `created_at`.
- Tonight: yes. Status: **fixed** (`00460cb`) [X]: both tests failed first (the next user got the token; the old URL worked), then pass. Id allocation itself is unchanged (no table rebuild).

**ON-SEC-3 · P3 · The Origin-check exemption and the cookie fallback disagree.**
- Where: `http.ts:98` exempts any `Authorization: Bearer …` header from the Origin check.
  `auth/routes.ts:117-118` uses the bearer only when it is `echo_dt_…`, and otherwise falls back to
  the cookie.
- Evidence [S·a]: a request carrying a cookie plus `Bearer x` is cookie-authenticated with no Origin
  check. A browser cannot send it cross-site without a CORS preflight, which ECHO never grants. It is
  latent.
- Fix: exempt only `Bearer echo_dt_…`.
- Verify: `http.test.ts`. A cookie plus a foreign bearer from a foreign Origin → 403.
- Tonight: yes. Status: **planned**.

**ON-SEC-4 · P3 · The last admin can be deleted through a race.**
- Where: `account.ts:302-306`. The `isLastAdmin` check runs before an awaited reauth (Argon2 +
  TOTP), and the delete runs after it, with no recheck.
- Fix: recheck inside `deleteUser`'s transaction. It returns false and the route answers 409.
- Verify: unit test that calls the guarded delete when no other admin remains.
- Tonight: yes. Status: **fixed** (`00460cb`) [X].

**ON-SEC-5 · P3 · A prototype key in the settings body gives a 500.**
- Where: `settings.ts:98-102` uses bare `SCHEMA[s]` lookups. `{"constructor":{"name":1}}` throws a
  TypeError.
- Evidence [S·a]: no prototype pollution was found, only a 500.
- Fix: use `Object.hasOwn`. Verify: unit test → 400. Tonight: yes. Status: **planned**.

**ON-SEC-6 · P3 · Anyone can lock out a known username, and the lock never decays.**
- Where: `auth/ratelimit.ts:26`. The lock doubles up to 24 h and is keyed by username only.
- Evidence [S·a]: this is the lockout the spec asks for (§4.4), so it is a design trade-off, not a
  bug. An admin with a live session can unlock themselves.
- Options: key the lock on (username, IP); or exempt IPs that signed in successfully before; or decay
  the lock after a quiet day.
- **Owner decision**: it changes a security control, so it is not changed tonight. Status:
  **deferred (decision)**.

**ON-SEC-7 · P3 · The per-user API rate limit in §5.6 is not implemented.**
- Where: `SETTINGS_AND_SECURITY.md:234` ("50 req/s burst, 600/min"). No limiter exists outside the
  auth routes and CSP reports.
- Evidence [S]: an invited user can loop `PUT /me/connections/navidrome`. Each call makes up to 3
  outbound requests to a public host.
- Fix: a per-user token bucket after `requireUser`. Streams are excluded, as the spec says.
- Risk: it could throttle legitimate bursts, such as the library loading 50 cover requests. Covers go
  through `/navidrome/cover` and need care.
- Tonight: only if time allows after the P2s. Status: **planned (stretch)**.

**ON-SEC-8 · P3 · Live Caddy trusts `Cf-Connecting-Ip` from any peer that reaches it.**
- Where: `~/docker/echo/install-routing.sh:32-33`. This is the owner's live routing, outside the
  repo.
- Evidence [S·a]: whether Caddy's port 80 is reachable other than through the tunnel was **not
  checked**.
- Fix (owner): `trusted_proxies` plus `client_ip_headers` in Caddy, or bind the site to loopback.
- Not touched tonight (live configuration). Status: **blocked (owner, live config)**.

**ON-SEC-9 · P3 · Minor hardening notes.**
- `/palette/:albumKey` calls `resolveSession` directly, so it skips the "require TOTP for all"
  enrolment gate. It reads covers only.
- The Navidrome URL error codes (`private_address` versus `unresolvable`) let a user probe which
  internal names resolve.
- Signed URLs survive session revocation (6 h, by design).
- Status: **deferred** (documented only).

### 3.2 Playback correctness and state

**ON-PB-1 · P1 · An aborted `play()` is treated as a broken stream, so the wrong track is skipped.**
- Where: `src/client/playback/navidrome.ts:283-294`. Every rejection except `NotAllowedError` emits
  `navidrome.stream`. `controller.ts:139-142` then skips to the next track with a toast.
- Evidence [S]: the HTML spec rejects pending `play()` promises with `AbortError` when `src`
  changes (the load algorithm) or when `pause()` is called. So Next→Next quickly skips the track
  after the intended one, and Pause before the first `playing` becomes a skip with autoplay.
  `NavidromeProvider` has no unit test.
- Expected: a play that was aborted is not an error (`PLAYBACK_ARCHITECTURE.md` §3, PLAY-02).
- Fix: ignore `AbortError` as well.
- Verify: new unit tests with fake media elements. A pending `play()` rejected with `AbortError` →
  no error event.
- Tonight: yes. Status: **fixed** (`1f39b3d`) [X]: 2 new unit tests failed first with `AbortError: interrupted`, then pass.

**ON-PB-2 · P1 · A stream that fails before its metadata skips at once, so the REL-02 retries
never run.**
- Where: `navidrome.ts:262-275`. The load wait resolves on `error`, then calls `play()` on the
  errored element. That rejects (`NotSupportedError`), and ON-PB-1's path emits a skip before the
  retry timer runs. The timer's `this.track === t` check then fails.
- Evidence [S]: the REL-02 E2E breaks streams only *after* their metadata. When Navidrome restarts,
  every track in the album is skipped in turn, each with a toast.
- Expected: REL-02 says a broken stream is reloaded 3 times, then skipped.
- Fix: after the wait, return if `el.error` is set, and let the error listener's retry or final
  emit own the error.
- Verify: unit test with fake elements, plus a new mock fault, `failStreams=N`. In an E2E, the first
  2 stream requests fail → the same track plays, with no skip toast.
- Tonight: yes. Status: **fixed** (`1f39b3d`) [X]: in real Chromium before the fix, a 2-request outage skipped tracks 1 and 2 (`Copper Rain 3` played); after it, the same track plays. Unit tests cover the 3-retry limit. Reliability spec 5/5.

**ON-PB-3 · P3 · Shuffle and repeat are not restored with the queue.**
- Where: `controller.ts:363-368`. `restore()` loads `shuffleOrder`, but `player.shuffle` stays
  false, so the dock shows "off" while playing shuffled.
- Fix: set `shuffle: !!q.shuffleOrder` on restore. Tonight: yes, if cheap. Status: **planned**.

**ON-PB-4 · P3 · The gapless preload timer uses wall-clock time from `load()`.**
- Where: `controller.ts:181`. After seeking to 3:50 of a 4:00 track, the timer fires after the track
  has ended, so there is a gap.
- Fix: reschedule on seek, play and pause from the current position. Status: **deferred** (P3,
  needs the PLAY-04 gap measurement re-run).

**ON-PB-5 · P3 · Media Session gaps.**
- There are no `seekbackward`/`seekforward` handlers and no `setPositionState`.
- The Navidrome handlers stay bound after switching to Spotify (unverified in a browser).
- Status: **deferred**.

**ON-PB-6 · P3 (low confidence) · `sendSeek` has no `finally`.**
- A rejected `provider.seek` would leave `seeking = true` (`controller.ts:235-244`).
- Status: **deferred**, pending a reproduction.

### 3.3 Lyrics timing, seeking, sync and rendering

**ON-LY-1 · P2 · A transient failure is cached as "no lyrics" for 3 days.**
- Where: `server/lyrics/resolve.ts:247-253`. `finish()` reports only the sources that settled.
  `routes.ts:151` negative-caches when every *reported* outcome is not-found.
- Evidence [S·a]: a source still retrying at the 4.5 s deadline is simply absent from `tried`.
- Fix: report each pending source as `timeout`. Timeouts already block negative caching.
- Verify: a resolver unit test with a source that is still pending at the deadline → its outcome is
  in `tried` and no negative entry is written.
- Tonight: yes. Status: **fixed** (`6110441`) [X].

**ON-LY-2 · P2 · An LRCLIB `/api/search` failure is returned as "not found".**
- Where: `sources.ts:205`, `if (!res.ok) return undefined`, which leads to `notFound`.
- Evidence [S·a]: a 429 or 503 on the search fallback resets the breaker and is negative-cached for
  3 days.
- Fix: return `httpError(…)` as `/api/get` does.
- Verify: unit test. `get` 404 then `search` 503 → outcome `error`, not `notFound`.
- Tonight: yes. Status: **fixed** (`6110441`) [X]. A search 404 stays "not found", as `/api/get`'s does.

**ON-LY-3 · P2 · NetEase YRC drops text after a "(".**
- Where: `parse.ts:128`, `YRC_WORD = /\((\d+),(\d+),\d+\)([^(]*)/g`.
- Evidence [S·a]: in `(0,500,0)Hello (500,500,0)(oh) (1000,500,0)world`, "(oh)" is lost.
- Fix: match the timing tuples only, and slice each word's text up to the next tuple.
- Verify: unit tests for both inputs.
- Tonight: yes. Status: **fixed** (`5ac88fd`) [X].

**ON-LY-4 · P2 · The timing check reads the last line, even a blank end marker.**
- Where: `parse.ts:448-449`, `lines.at(-1).start < trackDurationMs`, which runs before sorting.
- Evidence [S·a]: in `…[03:45.00]` (an empty end marker at the track's end), a correctly timed song
  becomes `sync: 'none'`.
- Fix: test the latest line that has text, after sorting.
- Verify: unit test. Tonight: yes. Status: **fixed** (`5ac88fd`) [X].

**ON-LY-5 · P2 · Arabic-script held words lose their letter joining.**
- Where: `client/stage/lyrics/layout.ts:72-76`. `emphasisOf` splits long held words into
  `inline-block` grapheme spans (`stage.css:212`), and that breaks cursive shaping.
- Expected: `LYRICS_EXPERIENCE.md` RTL/CJK robustness (LYR-27).
- Fix: no letter emphasis for joining scripts (Arabic, Syriac, N'Ko, Mongolian, Adlam).
- Verify: unit test. `emphasisOf` on a long Arabic word → null.
- Tonight: yes. Status: **fixed** (`35566ca`) [X] (unit; not checked visually with a real Arabic song). LYRICS_EXPERIENCE §5.5 updated.

**ON-LY-6 · P2 · The previous track's offset can be saved to the next track, and a shared timer
drops saves.**
- Where: `client/lyrics/loader.ts:84-90,125-141`. `start()` does not reset `offsetMs` or
  `pinnedSource`, and `saveTimer` is global.
- Evidence [S·a]: track A is at +300 ms. Skip to B and press `]` while B's lyrics are loading → B is
  saved as +350.
- Fix: reset the offset and pin on track change, ignore nudges until the doc is ready, and flush a
  pending save before switching tracks.
- Verify: loader unit test. Tonight: yes. Status: **fixed** (`52e8cce`) [X]: track 2 started at track 1's +150 ms before the fix. LYR-25 E2E 12/12 (both browsers).

**ON-LY-7 · P3 · `end < start` corrupts the timing spans.**
- Where: `parse.ts:425-429` never enforces `end ≥ start`. `timing.ts` assumes `from` is
  non-decreasing.
- Fix: drop an `end` that falls before its `start`.
- Verify: unit test. Tonight: yes. Status: **fixed** (`5ac88fd`) [X].

**ON-LY-8 · P3 · A 429 without a numeric `Retry-After` is not cooled.**
- Where: `sources.ts:63-68`. An HTTP-date header gives `NaN`, there is no default, and there is no
  cap.
- Fix: parse the date, default to 60 s, cap at 1 h. Tonight: if cheap. Status: **fixed** (`6110441`) [X].

**ON-LY-9 · P3 · Remaining resolver edge cases.**
- A pinned source that answers late is ignored, and the fallback is cached under the pin key.
- The breaker is keyed by source only, so one user's broken Navidrome trips S1/S4 for all users.
- An ISRC match is not checked against title or duration.
- Enhanced LRC: a whitespace-only chunk, and an unclosed last word that sweeps until the next line.
- A same-track reload race in the loader.
- Status: **deferred** (each needs care; none is a crash or a security issue).

### 3.4 Navidrome and Spotify integration

**ON-INT-1 · P2 · Clicking an upcoming Spotify row replaces Spotify's context with one track.**
- Where: `Dock.tsx:299`, `onPlay={() => c.jump(i)}`, which no provider gates. `controller.jump` →
  `spotify.load` → `{uris: [one]}`.
- Evidence [S·a]: the rest of the album is lost and playback stops after that track.
- Expected: Spotify's queue is add-only in ECHO (QUE-04, PLAYBACK_ARCHITECTURE §6.3).
- Fix: for a provider that owns its queue, `jump(i)` skips `i + 1` times with `skipNext`.
  Alternatively, the row is not a play target.
- Verify: `providers.test.ts`. A jump on an own-queue provider → `skipNext` calls, no `load`.
- Tonight: yes. Status: **planned**.

**ON-INT-2 · P3 · A Spotify album with a failed later page is stored as complete.**
- Where: `library-spotify.ts:140-147`.
- Fix: don't mark the album loaded when a page failed. Tonight: with ON-UI-2. Status: **planned**.

**ON-INT-3 · P3 · Subsonic `status: "failed"` comes back as HTTP 200 and is read as an empty
list.**
- Where: `navidrome/routes.ts:364-369` and the client readers.
- Status: **deferred** (needs per-method error mapping).

### 3.5 Queue and multi-device consistency

**ON-QU-1 · P2 · One failed initial queue fetch turns queue sync off for the whole session.**
- Where: `client/playback/queueSync.ts:37-39`, `catch { return; }`, before any listener is
  installed.
- Fix: retry with backoff, then install the listeners. Verify: unit test with a failing first `GET`.
- Tonight: yes. Status: **planned**.

**ON-QU-2 · P3 · The `pagehide` save has no `keepalive`.**
- The browser may cancel the save, and the last ≤ 15 s of position is lost.
- Fix: `keepalive: true` for that save. Tonight: if cheap. Status: **planned**.

**ON-QU-3 · P3 · Overlapping PUTs and the 409-restore echo can raise false "changed on another
device" notices.**
- Status: **deferred** (needs a careful serialisation design and an E2E with two pages).

**ON-QU-4 · P3 · A foreign drop onto a queue row moves the first track.**
- Where: `Dock.tsx:272`. `Number('')` is 0.
- Fix: ignore an empty payload. Tonight: yes. Status: **planned**.

### 3.6 Visualizer correctness, performance, reduced motion

**ON-VZ-1 · P1 · The analyser times onsets with song time, so Reverb's rings stop after the first
track.**
- Where: `client/playback/analyser.ts:178,181,192`. `tMs` is the song time (`stage/loop.ts:72`), and
  one `AnalyserFeatures` lives for the whole session.
- Evidence [S]: after track 1's last onset at, say, 239 s, track 2 starts at 0. `0 − 239000 ≥ gap`
  is false, so there are no onsets until song time passes 239 s. Future-stamped onsets also count as
  "recent", which pins the intensity rate. The same happens after any backwards seek or on repeat.
- Expected: VISUALIZER_SPEC §3–§4 (onsets spawn rings), VIS-06.
- Fix: an internal monotonic clock, accumulated from `dtMs`, for onset bookkeeping. Onsets start at
  −∞.
- Verify: unit test. Onsets fire on the next track after song time jumps back from 239 s to 0.
- Tonight: yes. Status: **fixed** (`0347e5f`) [X]: the new test saw 0 onsets in the first 5 s of the next track before, ≥ 7 after.

**ON-VZ-2 · PERF-04's analyser clause ("analyser polling stops").**
- Evidence [S + X]: `AnalyserFeatures` has no timer. It is pulled only by `loop.frame()`, which
  never runs while hidden. The unit test now also asserts that features are not sampled while
  hidden.
- Status: **verified** (Chromium E2E plus unit). See §4.

### 3.7 UI quality, accessibility, responsive behaviour, empty states

**ON-UI-1 · P1 · A page load while the server is restarting gives an empty, dead app.**
- Where: `client/session.ts:31-33` maps any failure to `offline`, which `main.tsx` treats as the
  fixture-only dev shell (production: no library, no provider). `api.ts:37-40` marks the server down
  only when `fetch` rejects, so Caddy's bodiless 502 shows nothing.
- Evidence [S]: every `docker compose up -d` on the box gives a few seconds of 502s. A page opened
  then shows an empty library and never recovers without a manual reload.
- Expected: REL-01's "ECHO server unreachable" state that recovers on its own.
- Fix:
  - A production build whose session load fails shows a full-page "ECHO server unreachable" block
    with Retry, probes with backoff, and reloads itself when health answers.
  - `api()` also reports the server down on 502/503/504 without an ECHO error code.
- Verify: unit test of the `api()` 502 mapping, plus an E2E against the production build is not
  possible (E2E runs the dev build with fixtures). Unit-test the decision function instead.
- Tonight: yes. Status: **fixed** (`f46463b`) [X]: exercised on a production build behind a fault proxy. Before: "Nothing in your library yet. Connect a server in Settings.", still there 5 s after recovery. After: "ECHO server unreachable — retrying in 1 s" + Retry, reloaded by itself 1.3 s after the proxy recovered.

**ON-UI-2 · P2 · An album that fails to load shows "0 tracks", or "not in your library".**
- Where: `library-navidrome.ts:132-136`, `library-spotify.ts:133-147` and `LibraryViews.tsx:228-247`.
  `strings.states.albumFailed` exists but is never used.
- Expected: DS-07 (every block has an error state with Retry).
- Fix: `loadAlbum` rejects on failure. `AlbumView` shows `BlockError(albumFailed)` with Retry when
  the album could not be loaded.
- Verify: an E2E in `states.spec.ts` aborts `getAlbum` → "Couldn't load this album." + Retry, which
  recovers.
- Tonight: yes. Status: **planned**.

**ON-UI-3 · P2 · With Spotify connected, failed playlists and search show "none".**
- Where: `library-spotify.ts:243-254` uses `.catch(() => [])` for each provider, so
  `PlaylistsTab`'s error block can never show.
- Fix: rethrow when every provider failed. Show a partial result when one succeeded.
- Verify: unit test of `combineLibraries`. Tonight: yes. Status: **planned**.

**ON-UI-4 · P3 · Two admin sections swallow load errors.**
- The Audit section shows "No audit entries" when the load failed (`AdminViews.tsx:223`).
- The Spotify-matching section shows a skeleton forever (`SpotifyViews.tsx:303`).
- Fix: an error block with Retry. Tonight: yes. Status: **planned**.

### 3.8 API contracts, validation, errors

**ON-API-1 · P3 · A JSON `null` (or non-object) body gives a 500 instead of a 400.**
- Where: `admin.ts:118,244,293` and `lyrics/routes.ts:167,224` read fields from `await
  c.req.json()` without checking it is an object.
- Fix: reuse `body(c)` (`auth/routes.ts:79`). Verify: unit test → 400. Tonight: yes. Status:
  **planned**.

**ON-API-2 · P3 · OpenAPI omits statuses the server really returns.**
- Missing: 423/429 on the reauth routes, 413, 403 `totp_enrolment_required`, 400 on two GETs, and a
  `queue: null` body.
- Fix: document them. Tonight: yes, once the code changes are in. Status: **planned**.

### 3.9 Database consistency, migrations, recovery

**ON-DB-1 · P2 · A failed or interrupted backup leaves a partial file that counts as that day's
backup.**
- Where: `server/admin-cli.ts:68,78`. `VACUUM INTO` writes straight to the final name, and the daily
  job skips any day whose file exists.
- Fix: write to `.tmp`, run `PRAGMA quick_check` on it, rename it into place, and remove the tmp on
  failure. Stale tmp files are swept.
- Verify: unit tests. A failure leaves no final file and no tmp, and the next run retries. A good run
  gives a file that passes `quick_check`.
- Tonight: yes. Status: **fixed** (`25d8ff6`) [X]: the test failed first (the leftover stayed), then passes, along with the DEP-03 restore drill.

**ON-DB-2 · P2 · A failed cache or DB write in a detached promise crashes the server.**
- Where: `lyrics/routes.ts:140` (`onLate: … void deps.cache.put`), `index.ts:305` and
  `lyrics/routes.ts:205` (`void matcher.sweep()`), and `spotifyMatch.ts:375-386` (an UPDATE outside
  the try). No `unhandledRejection` handler exists, and Node exits on one.
- Evidence [S·a]: a disk-full error plus a late lyric answer → the process exits, and
  `unless-stopped` restarts it in a loop.
- Fix: `.catch(log)` on the detached calls. Cache writes are best-effort inside the route (a failed
  write must not turn a found lyric into a 500).
- Verify: unit test. A cache whose `put` rejects → the route still answers 200 and nothing is
  unhandled.
- Tonight: yes. Status: **fixed** (`c409bdf`) [X]: lyrics answered 500 on a failing cache write before, 200 after; the palette likewise. No global `unhandledRejection` swallow was added on purpose: a crash plus restart is a safe failure mode, and the known detached paths are fixed at their source.

**ON-DB-3 · P3 · Nothing is retained or pruned.**
- Expired sessions are deleted only when presented, and `GET /me/sessions` lists them for ever.
- Invites and the audit log grow without limit. The in-memory limiter maps are never swept.
- Fix: a daily prune next to the backup, and filter the sessions list by `expires_at`. Tonight: if
  time allows. Status: **planned (stretch)**.

**ON-DB-4 · P3 · Migration and upgrade safety.**
- The version is read outside the transaction (a race between the server and the CLI at upgrade).
- There is no backup before a pending migration.
- `rotate-master-key` exits 0 when it skipped values.
- Status: **deferred** (the first two need a migration-runner change, which is risky to rush).

**ON-DB-5 · P3 · No decode-size limit, and the palette cache is never swept.**
- Where: `palette/decode.ts:8` uses sharp's default `limitInputPixels` (≈ 268 Mpx). A user-chosen
  Navidrome can serve a PNG bomb inside its 8–16 MiB cap.
- Fix: `limitInputPixels: 25e6`, enough for a 5000² cover. Tonight: yes. Palette sweep: **deferred**.

### 3.10 Deployment, Docker, observability, resources

**ON-DEP-1 · P3 · `compose.example.yaml` as shipped answers 403 to everything, and has no
resource limits.**
- Evidence [S + X]: `ECHO_PUBLIC_ORIGIN` is set and `ECHO_TRUSTED_PROXY` is empty, so `http.ts`
  refuses non-https requests behind Caddy. The live container has no memory or pids limit
  (`docker inspect`: `Memory 0`, `PidsLimit <none>`).
- Fix: a commented `ECHO_TRUSTED_PROXY` line, plus example `mem_limit`/`pids_limit`/`cpus` sized for
  the OptiPlex. The measured peak RSS is 213 MB with 3 listeners (M9).
- The live compose file is **not** changed tonight. Status: **planned (example only)**.

**ON-DEP-2 · P3 · Shutdown waits for streams, and the DB is never closed.**
- Where: `index.ts:346`, `server.close(() => process.exit(0))`. An open audio stream keeps `close()`
  pending, so `docker stop` ends in a SIGKILL after 10 s.
- Fix: close idle connections, force-close after 5 s, then `db.close()`. Tonight: yes. Status:
  **planned**.

**ON-DEP-3 · P3 · CI builds the image but never starts it.**
- Fix: a container smoke step (start it with a temp key, then `/api/v1/health`). There is no remote,
  so this cannot be proven on CI tonight. Status: **deferred**.

**ON-DEP-4 · info · The live image is one commit behind.**
- It was built from `21dc5f1`; `a2a1cb7` and tonight's work are not deployed. Redeploying is the
  owner's call.

### 3.11 Tests, CI, browser coverage, acceptance criteria

**ON-TST-1 · P1 · The Firefox `tnum` smoke test fails 20/20, which blocks the isolated suite.**
- Where: `tests/e2e/smoke.spec.ts:60`. It waits on `document.fonts.ready`, which resolves at once
  when no load has started, so Firefox measures a fallback face whose digits are tabular. With an
  explicit `document.fonts.load`, Roboto Flex measures 57/81 px proportional and Mona Sans 61/104
  [X]. It is a test race, not an app defect.
- Fix: load both faces and assert they loaded before measuring. This makes the test stricter.
- Verify: 10× per browser.
- Status: **fixed** (`62306f5`) [X] (20/20).

**ON-TST-2 · P2 · `NavidromeProvider` has no unit tests.**
- The REL-02 and PLAY-04 E2Es are its only coverage.
- Fix: a fake-element harness, added with ON-PB-1/2. Status: **fixed** (`1f39b3d`): `navidrome.test.ts`, 4 tests.

**ON-TST-3 · PERF-04's analyser clause had no assertion.**
- The assertion was added (see ON-VZ-2). Status: **fixed** (`62306f5`) [X].

**ON-TST-4 · Remote CI has never run.**
- The owner chose to have no remote. The local CI equivalent (`scripts/e2e-container.sh`, the pinned
  Playwright image under Xvfb) is the evidence used tonight for Firefox WebGL (VIS-07).

### 3.12 Documentation inconsistencies and deferred work

- **ON-DOC-1** · `docs/reviews/M5.md:58` says "since built: … crossfade". Crossfade is not built:
  `crossfadeSec` has no consumer, and the Settings toggle is disabled ("later"). [S] **planned**.
- **ON-DOC-2** · The `ACCEPTANCE_CRITERIA.md` status says "Vitest 1204, Playwright 384" (stale).
  VIS-09 (needs a manual 10-bit capture) is missing from the open table. VIS-07 is "Pass" in
  M2's close-out but "waiting for remote CI" in the table. [D] **planned**.
- **ON-DOC-3** · `IMPLEMENTATION_PLAN.md`'s M5 "Open parts" lists Media Session next/previous,
  Playlists/Starred, sorts and search, which are built (`main.tsx:121-124`, `LibraryViews.tsx`).
  Crossfade and the server-side Artists list remain. [S] **planned**.
- **ON-DOC-4** · The `docs/README.md` status is dated 2026-10-24 and predates the M3 shell, NetEase,
  matching and backups. [D] **planned**.

## 4. M2 open items, reconciled against the current repo

| Item | What it means (plan / criteria) | Status tonight | Evidence |
|---|---|---|---|
| DS-01 design judgment / token grep | No raw values outside tokens; judged at M2 close and re-checked at M9 | **Pass** (automated grep in Vitest, green) | `design-rules` test in the 1242; M2 close-out, M9 |
| DS-02 coloured-pixel measurement | ≤ 3 % budget **retired 2026-10-25** with Material 3 (DESIGN_SYSTEM §3.2); the CSS bans remain | **Pass** for the remaining clause (CSS inspection test). The pixel script was removed with the budget | `ACCEPTANCE_CRITERIA.md` DS-02 wording |
| DS-04 squint test (needed M3) | Three masses on a 16 px blur of Listen | **Pass** (M3 review, then M9) | `reviews/M3.md:369`, `M9.md:19` |
| DS-06 snapshots + remote CI | Every §9 state on `/__ui`, snapshotted | Snapshots pass on the host and in the CI image; **a real CI run is impossible without a remote (owner's choice)**: blocked by decision, not failing | `ui.visual` in the E2E run |
| DS-08 artwork rules (later milestone) | Never cropped, overlaid, scaled or animated; also M7 | Shell + Spotify code parts done; **real-cover V check open** (needs a Spotify account) | `reviews/M7.md:54` |
| VIS-07 Firefox context loss | CSS room on loss, full recovery | Chromium pass on the host; Firefox **run tonight in the CI image** (see §8) | §8 |
| VIS-09 10-bit capture | Dither present, no banding in a 10-bit capture | Automated dither test passes; **10-bit capture needs the owner's hardware**: not passed | M2 close-out |
| PERF-04 analyser clause (needed M5) | Hidden tab: 0 rAF and no analyser polling | **Verified**: pull-only analyser plus a new unit assertion; E2E hidden-tab test passes | ON-VZ-2 |
| `fixture=` deterministic mode | Recorded features via `?fixture=` | **Done** (2026-10-23 follow-up); exercised by `stage.spec.ts` and `lyrics.spec.ts` | `reviews/M2.md:534` |
| Settings `blank-gap` (deferred to M8) | `inspect.mjs` FAIL on the placeholder | **Closed in M8** (0 FAIL); M9 re-run 0 FAIL | `reviews/M8.md`, `M9.md` |
| Task 6/7 leftovers | — | None open in M2's close-out beyond the rows above | `reviews/M2.md` close-out |

## 5. Priority order (dependency-aware)

1. ON-TST-1 (done): gets the E2E suite green, so every later change is measured against a green
   baseline.
2. P1 playback and visuals: ON-PB-1 → ON-PB-2 (same code path; one fake-element harness, ON-TST-2) →
   ON-VZ-1.
3. P1 reliability: ON-UI-1 (with the `api()` 502 mapping).
4. P2 security: ON-SEC-1, ON-SEC-2.
5. P2 data integrity: ON-DB-1, ON-DB-2.
6. P2 lyrics: ON-LY-1, -2 (resolver/sources) → ON-LY-3, -4, -7 (parser) → ON-LY-5 (layout) →
   ON-LY-6 (loader).
7. P2 error states and integration: ON-UI-2 + ON-INT-2 → ON-UI-3 → ON-INT-1 → ON-QU-1.
8. Cheap P3s: ON-API-1, ON-SEC-3/4/5, ON-QU-4, ON-PB-3, ON-DB-5, ON-DEP-2, ON-UI-4, ON-LY-8,
   ON-QU-2, ON-DEP-1.
9. Docs: ON-DOC-1…4, ON-API-2, the acceptance status.
10. Stretch: ON-SEC-7 (per-user rate limit), ON-DB-3 (retention).
11. Final: full `pnpm check`, full E2E on the host, Firefox Stage in the CI image, audit, gitleaks,
    `git diff --check`.

## 6. Realistic overnight scope

Items 1–9 in §5 are in scope. Each is a contained change with a test that fails before it and
passes after. The stretch items are attempted only after a fully green run of everything before
them.

## 7. Deliberately deferred (and why)

| Item | Why not tonight |
|---|---|
| ON-SEC-6 lockout keying | It changes a security control the spec mandates: the owner's decision |
| ON-SEC-8 Caddy trusted proxies | Live routing config outside the repo; needs sudo |
| ON-PB-4 gapless reschedule, ON-PB-5 Media Session | P3; need the PLAY-04 gap re-measured on real audio |
| ON-QU-3 queue PUT serialisation | Needs a two-device E2E design; risk of new conflicts if rushed |
| ON-LY-9 resolver edge cases | Each is a behaviour choice (pins, breaker scope, ISRC trust) |
| ON-INT-3 Subsonic failed-status mapping | Per-method error semantics; P3 |
| ON-DB-4 migration-runner changes | Rushing the migration runner on a live DB is the wrong trade |
| ON-DEP-3 CI container smoke | No remote, so it cannot be proven |
| Crossfade, server-side Artists | Planned features, not defects |
| SEC-19, DEP-03 M, PERF-01, REL-06, DS-05, A11Y-04 M, VIS-09, the Spotify M checklist | Need the owner, people, real devices or accounts |

## 8. Verification log

(Filled in as work lands.)

## 9. Commits

(Filled in as work lands.)
