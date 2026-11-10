# Testing

Status: COMPLETED. Everything listed under "Run" was executed on 2026-11-10 on the development
machine; the results are the tools' own output. Nothing here was run against production, on a
phone, or over a real network.

## 1. Run

| What | Command | Before the audit | After |
|---|---|---|---|
| Typecheck, Biome, unit and integration tests, build | `pnpm check` | exit 0; 72 files, 1,505 tests pass; 20 Biome warnings | exit 0; 74 files, 1,515 tests pass; 20 Biome warnings (the same) |
| Windows | `dotnet test Windows/Tests` | 112 pass | 114 pass |
| End to end (Chromium, Firefox) | `pnpm test:e2e` | 517 pass, 4 fail, 99 skipped, 19 did not run (at `166a407`) | three runs, see §3 |
| Android | `./gradlew testDebugUnitTest assembleDebug` (in `Android/`) | 11 pass | 13 pass; debug build succeeds |
| Linux | `cargo test`, `cargo clippy` (in `Linux/`) | no tests | 2 pass; clippy clean |
| Dependencies | `pnpm audit --prod` | no known vulnerabilities | not rerun: no dependency changed |
| Proxy benchmark | `node scripts/bench-proxy.ts 100` | [PERFORMANCE.md](PERFORMANCE.md) §2 | same section |

`pnpm check` failed twice on the way and was fixed, not skipped: a type error in the new bench
script, and `src/server/isolation.test.ts` refusing a route (`PATCH /me/queue`) that no test had
shown to be isolated between users. That test now covers it.

## 2. Tests added

| Test | What it shows | Real or mocked |
|---|---|---|
| `src/server/navidrome/client.test.ts` (3) | a paused reader outlives the idle timeout (fails without the fix); a silent server still ends the stream; a server that never answers gives `timeout` | real sockets, a local HTTP server |
| `src/server/navidrome/stream.test.ts` (1) | a listener that disconnects closes the upstream request | real sockets through `@hono/node-server` |
| `src/server/queue.test.ts` (+1) | `PATCH`: moves the position, 400, 404, 409 | the real app and SQLite (in memory) |
| `src/server/isolation.test.ts` (extended) | one user's `PATCH` cannot move another's position | the real app |
| `src/client/api.test.ts` (+4, 1 adapted) | retry twice at most; 429 waits `retry-after`; a write is sent once; the delays | `fetch` mocked, fake timers |
| `src/client/playback/queueSync.test.ts` (+1, 1 adapted) | saves after the first are `PATCH` without the queue; a refused `PATCH` falls back to `PUT` | `fetch` mocked |
| `Android/.../QueueTest.kt` (+2) | a 3,000-song queue is over the server's limit and the cut one fits, from the far end; the retry delays | pure functions |
| `Linux/src/api.rs` tests (2) | a read answered 502 twice by a proxy is asked a third time and succeeds; the retry delays | a real local socket |
| `Windows/Tests/PlayerTests.cs` (+2) | the same two behaviours on Windows; retries of reads, none of writes | `HttpMessageHandler` fakes |

The client tests mock the network, so they show the client's logic, not an exchange with a server.
The exchange itself is covered where it could be: the server tests run the real routes, and the E2E
suite runs the real web client against a real ECHO server and the mock Subsonic server.

## 3. End to end, in full

Failures in each full run on `deep-audit`:

| Test | Run 1 | Run 2 | Run 3 | Base `166a407` |
|---|---|---|---|---|
| chromium · `shell.visual` · Home with the player paused at 1024, 1440, 2560 | fail | fail | fail | fail |
| firefox · `lyrics` · LYR-17 (pause freezes the sweep) | fail | fail | fail | fail |
| chromium · `shell.visual` · Listen stage, Ambient frame, at 390 | fail | fail | pass | pass |
| firefox · `motion` · play and pause morph | pass | fail | pass | pass |
| Passed / failed | 516 / 5 | 515 / 6 | not counted (4 result folders: the two known groups) | 517 / 4 |

- **Home visuals and Firefox LYR-17** are the project's known failures (the Home page's look
  depends on the time of day; LYR-17 on Firefox was open before). They fail the same way on the
  base commit.
- **Ambient frame at 390** failed on the branch and not in the one full base run, so it was
  checked directly: the test repeated 12 times on each (`--project=chromium -g "Listen stage,
  Ambient frame" --repeat-each=12`). It failed **7 of 12 on the base** and 4 of 12 on the branch. It
  is a flaky screenshot (about 2% of pixels of a WebGL frame) that was there before this work.
  It should be added to the known list, or fixed ([TODO.md](TODO.md)).
- **Firefox "play and pause morph"** failed once in three runs. Not investigated further; treated
  as a flake under load, which is an assumption.
- **"Did not run" (19, or 12)** and **skipped (99)** are the same on the base: tests that are
  skipped per browser, and serial groups that stop after a known failure.

The specs that exercise what changed (`reliability.spec.ts`, `states.spec.ts`, `api-client.spec.ts`)
passed in every run.

## 4. Not tested

- **Android on a device or emulator:** the save path in `Playback.save()` (PATCH, the fallback) and
  the retry loop in `Api.call()` compile but no test runs them; only `fitted()` and `retryDelay()`
  are tested.
- **Linux app itself** was not launched; its API client is tested.
- **Apple:** not built, not run, not changed.
- **Windows on Windows:** the test suite runs headless on Linux with a null audio device. The app
  was not run on a Windows machine in this audit.
- **A new client against the deployed server**, and the reverse: production was not touched. The
  fallback (`PATCH` refused → `PUT`) is covered by unit tests on both clients.
- **Real network faults**, long transcodes paused for minutes against a real Navidrome: the idle
  timeout fix was shown against local HTTP servers with a shortened timeout.
- **Load:** many users at once.
