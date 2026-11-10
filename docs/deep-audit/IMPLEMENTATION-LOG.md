# Implementation log

2026-11-10, in order. Branch `deep-audit`, from `windows-baseline` at `166a407`.

1. **Baseline.** `pnpm check`: 72 test files, 1,505 tests pass; build passes; Biome: 20 warnings.
   `pnpm audit --prod`: clean. `pnpm outdated`: patch/minor only.
2. **Read** the server (`http.ts`, `auth/`, `navidrome/`, `youtube/`, `queue.ts`), the web's
   `api.ts`, `connection.ts`, `playback/`, `shell/fresh.ts`, and each native client's API and
   playback files.
3. **`scripts/bench-proxy.ts`** written; first numbers taken before any change
   ([PERFORMANCE.md](PERFORMANCE.md) §2). Two mistakes on the way: requests too close together hit
   the API budget (now 105 ms apart); a wrong song id gave 502 (the mock's ids are `al-1-t1`).
4. **Hypotheses timed** (URL check, connection reuse, client call): all three dropped
   ([PERFORMANCE.md](PERFORMANCE.md) §3).
5. **Reading production's configuration was refused** by the session's safety policy. Not worked
   around. Recorded as an assumption where it matters.
6. **Idle-timeout bug** reproduced in a script, then as a failing test, then fixed:
   `src/server/navidrome/client.ts`, `client.test.ts` (3 tests).
7. **Listener disconnect** verified over real sockets: `src/server/navidrome/stream.test.ts`. No
   change needed.
8. **Web `api()`**: timeout, bounded retries, backoff with jitter. `src/client/api.ts`,
   `api.test.ts` (7 tests).
9. **Probe loop**: timeout per probe, jitter. `src/client/connection.ts`.
10. **`PATCH /me/queue`**: `src/server/queue.ts`, `queue.test.ts`, `docs/api/openapi.yaml` (the
    contract test failed until the route was documented).
11. **Web queue sync** uses it, with fallback: `src/client/playback/queueSync.ts`,
    `queueSync.test.ts` (12 tests).
12. **Windows baseline**: `dotnet test Windows/Tests`: 112 pass.
13. **Windows**: `Api.Send` retries reads; `Player.SaveNow` sends the position alone when the queue
    is unchanged, with fallback; `ProgressiveStream` retries back off. Two tests added: 114 pass.
14. **`pnpm check` failed**: `src/server/isolation.test.ts` requires every route to be shown
    isolated, and the new `PATCH` was not. Test extended (a second user's `PATCH` gets 404 and the
    first user's position is unchanged). Then: 74 files, 1,515 tests pass.
15. **Bench repeated** after the changes: no difference beyond noise, as expected.
16. **Existing docs updated**: `docs/PLAYBACK_ARCHITECTURE.md` §5.5 and §5.8,
    `docs/TECHNICAL_ARCHITECTURE.md` (route table), `Windows/README.md`.
17. **E2E suite** run; results in [TESTING.md](TESTING.md).
18. **Android, Linux, Apple** left unchanged; findings in [TODO.md](TODO.md).
