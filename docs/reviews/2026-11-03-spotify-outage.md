# Spotify streaming outage: overnight report (2026-11-02 → 03)

## Bottom line

**I could not confirm the root cause from here, and I did not fix the outage itself.** Everything on
ECHO's side that I could test is healthy. The evidence points at **Spotify refusing the app**, most
likely its Development Mode **quota**, and ECHO handled that case badly: it retried, kept asking,
and told you the wrong thing. I fixed that, so the next failure names its cause. Nothing is
deployed; the container still runs `7e7d766`.

The cause is one look away. In the browser on echo.folk3s.com, open DevTools → Network, filter
`api.spotify.com`, and press play on a Spotify track. The status and body of the failing calls say
which one it is (see "What to check first").

## What I ruled out (with evidence)

| Suspect | Result |
|---|---|
| ECHO server | Container healthy since 22:50. Every `/spotify/*` route answered 200 after the redeploy, `POST /spotify/token` included. No 4xx/5xx on any Spotify route, no CSP reports, no error lines. |
| CSP / security headers | Loaded the **real** Spotify SDK (v1.10.0) on a page with ECHO's exact CSP: script, iframe and bundle load, **zero violations**. The SDK's iframe asks for `allow="encrypted-media; autoplay"` and ECHO's Permissions-Policy does not restrict either. |
| ECHO playback code | No playback code changed since 10-29 except the source switch. 1446 unit tests and all 23 Spotify e2e passed against the fake Spotify before I touched anything. |
| "Your account is seen as free" (`/me` without `product`) | Ruled out for you: the Spotify library is created at page load (the logs show `/spotify/token` right after `/spotify/status`), which only happens when your connection is `connected`. It was still a real hazard; fixed (below). |
| A Spotify-wide outage | Searched; found none. (Limited search, treat as "not found", not "none".) |

## What points at Spotify refusing the app (inference, not proof)

1. **The 22:51 sweep.** It started 60 s after boot and logged "done" at 22:52:06, about **15 s**
   later, with `matched 14,861 / none 7,926`: identical to the 21:50 baseline, though ~7,200 tracks
   had never been asked (3,799 of them with an ISRC, which Spotify's ISRC search normally matches).
   The only ways the code gets there are a refused app token, a first 429 with a Retry-After over
   2 min, or ten failures in a row. All three were **silent** in the log.
2. **History.** Before `ccaec9f`, every daily sweep died at its first search with a 429; only 689 of
   22,787 tracks were ever asked. A quota that is already spent looks exactly like that.
3. **Spotify's own docs** (read through a page-fetch summariser; verify at the source): Development
   Mode has a **quota separate from the rate limit**, shared by the developer's apps, with
   unpublished limits. When it is used up, every call answers `429` with
   `{"error":{"status":429,"message":"Too many requests","reason":"QUOTA_EXCEEDED"}}`. The app
   owner must also have Premium ("for apps in development mode to function"). Developers report
   Retry-After values of 19 to 48 hours.
4. **ECHO's assumption was wrong for that case.** The browser slept at most 30 s and asked again,
   then said "Spotify isn't answering. Try again in a moment." The server waited and carried on.
   Every 403 that was not a missing scope said "this account isn't on the app's user list".

Candidates, most to least likely: (1) quota exceeded, (2) a long rate-limit penalty, (3) the app
owner's Premium lapsed (403, "Active premium subscription required for the owner of the app"; one
report says it can take hours to clear after renewing), (4) something I could not see from here.

## What I changed (7 commits on `main`, none deployed)

| Commit | Change |
|---|---|
| `3654416` | Browser: a Retry-After over 30 s, or a second 429, starts a **page-wide cooldown**: no Web API call is sent, the SDK is not asked to connect, and the message says how long Spotify asked ECHO to wait. |
| `494724d` | Browser: a 403 shows **Spotify's own reason** ("Spotify refused ECHO: …") unless it really is the user-list refusal. |
| `5321a71` | Server: the log says **why** Spotify refused the app: token refused (status, error, description, Retry-After), and why the sweep left Spotify (failure count, Retry-After, Spotify's message). A refused token is asked for once per run, not once per 500 songs. `createSpotifyAppToken` had no tests; it has two. |
| `7900315` | `QUOTA_EXCEEDED` is recognised on both sides: never retried, a long pause (the Retry-After, else 15 min), the sweep leaves Spotify at once, and any long Spotify pause now holds for plays too. |
| `2dc2043` | Minor bug: a refused SDK connect left an unhandled "ready timeout" rejection 15 s later. |
| `ca9687e` | Minor bug: a `/me` without `product` (Development Mode drops it, per Spotify's February guide) is no longer treated as a Free account. |
| (docs) | `PLAYBACK_ARCHITECTURE.md` §4.5 and §8, `LYRICS_INTEGRATION.md` §4.3 describe the above; this report. |

Every fix has a test that failed first. At the end: **1457 unit tests pass**, `tsc` clean, biome at
its baseline (0 errors, 29 existing warnings), Spotify, source, matching, settings and lyrics-source
e2e pass on Chromium.

## What I could not do

- **Confirm against the live Spotify.** I have no way to call it as your app or your user. I read
  the container's log as you asked (route, status and the matching counts), not the database. The
  tests use a fake Spotify, which cannot show a real quota.
- **Deploy.** Deploys are yours (the classifier blocked mine last time and nothing tonight asked for
  one). The build context is the working tree, which is clean at HEAD.
- **Make the quota reset.** If it is the quota, waiting (or fewer calls) is the only cure.

## What to check first

1. **Find the cause (1 minute).** DevTools → Network → `api.spotify.com`, press play on a Spotify
   track. Then:
   - `429` with `"reason":"QUOTA_EXCEEDED"` → the quota. Look for other dev-mode apps on the same
     Spotify developer account; they share it.
   - `429` with a large `retry-after` → a penalty; stop using Spotify until it passes.
   - `403` → read the `message` in the body (Premium lapsed on the **app owner's** account, or the
     user list).
   - `401` on `check_scope` → token or scope problem (reconnect Spotify in Settings → Account).
2. **Deploy** when you are happy: `cd ~/docker/echo && docker compose build && docker compose up -d`.
   From then on the page itself says why ("Spotify says this app's quota is used up. ECHO will ask
   again in 15 minutes").
3. **Read the server's side.** Admin → Server → Spotify matching → run it, then
   `docker logs echo 2>&1 | grep -i "spotify app token\|leaving Spotify"`.
4. **Consider pausing the background sweep** (Admin → Server → "Match the Navidrome library with
   Spotify in the background", off) while the quota recovers. It is ~7,000 searches at 4 a second.

## Found on the way

- `tests/e2e/settings.spec.ts` **ACC-03** fails when run together with the spotify and account specs
  (2 of 2 runs, also on the baseline `7e7d766`); it passes alone. Not caused by tonight's work.
- **"Spotify mode: Liked Songs"** failed 2 of 8 under load on the baseline, 0 of 8 on HEAD. My
  heavier stress run hit the 5-seat limit in the test setup; that was my doing, not a product bug.

## Suggestions: what to focus on next

1. **Cut ECHO's own Spotify traffic.** `library-spotify.ts:133` (`const saved = loadSaved()`) pages
   through **every** saved album, 50 per call, at **every page load**, including in Navidrome mode:
   your logs show four loads in under five minutes. Load the first page lazily, and only when the
   Spotify source is open. Against an unpublished, shared quota this is the biggest avoidable spend.
2. **Make the background Spotify sweep gentler or opt-in.** 4 requests a second for ~30 minutes is a
   lot against a shared quota. ListenBrainz and MusicBrainz cost it nothing; keep Spotify for
   ISRC-only misses at ~1 a second, or on request.
3. **A "Spotify health" card in Admin.** The server cannot see browser-to-Spotify calls. Let the
   browser report the last refusal (status, reason, time) to a small endpoint; show it next to the
   seat count. That turns tonight's 40-minute investigation into a glance.
4. **Fall back to your own files.** ECHO already maps Navidrome tracks to Spotify ids. The reverse
   lookup would let "play" use the Navidrome copy when Spotify is refusing: the product's
   Navidrome-first idea, and it makes the outage invisible for owned music.
5. **Know what is live.** Stamp the git commit into the image (build arg) and show it in
   `/api/v1/health` and the Admin footer. Past sessions had to guess ("presumably live, not
   verified"); this ends that. A Bash permission rule for `docker compose build/up` in
   `~/docker/echo` would also let overnight sessions deploy on your word.
6. **Accept Development Mode honestly.** Extended Quota is organisation-only, so plan for 5 users and
   a small quota: document it in Settings next to the seat count and design the Spotify side as an
   add-on that degrades.
7. **Make the two flaky e2e specs reliable** so a red run means something again.
