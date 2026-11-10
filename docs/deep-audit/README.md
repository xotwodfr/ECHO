# Deep audit, 2026-11-10

An audit of the whole of ECHO with two priorities: how songs are streamed and played, and how the
clients talk to the ECHO server. It was an implementation task: what was found and could be fixed
safely was fixed, with tests, on the branch `deep-audit` (from `windows-baseline` at `166a407`).
Nothing here is deployed, pushed or released: each of those needs the owner's word.

Every statement in these files is one of:

- **Verified**: read in the code at the path given, or shown by a test or script that was run.
- **Measured**: a number from a run recorded in [PERFORMANCE.md](PERFORMANCE.md), with how to repeat it.
- **Assumption**: said so in the sentence. Not checked.

## The files

| File | What it holds |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | The parts, how a request and a song travel, where the code is |
| [AUDIO-STREAMING.md](AUDIO-STREAMING.md) | The audio path of each client, what was found, what changed |
| [ECHO-COMMUNICATION.md](ECHO-COMMUNICATION.md) | Timeouts, retries, stale answers, expired sign-ins, the queue save |
| [PERFORMANCE.md](PERFORMANCE.md) | The measurements, and the hypotheses they disproved |
| [SECURITY.md](SECURITY.md) | The review of the security controls; nothing was weakened |
| [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md) | What was done, in order |
| [TESTING.md](TESTING.md) | What was run, with results, and what was not |
| [TODO.md](TODO.md) | What remains, by priority |

## Status

| Objective | Status | Notes |
|---|---|---|
| Baseline (tests, lint, build, dependency audit) | COMPLETED | [TESTING.md](TESTING.md) |
| Architecture review | COMPLETED | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Audio streaming: server proxy | COMPLETED | One bug found and fixed (a paused listener lost its stream) |
| Audio streaming: web client | COMPLETED | No change needed; reviewed |
| Audio streaming: Windows client | COMPLETED | Stream retries now back off |
| Audio streaming: Android, Linux, Apple clients | COMPLETED (review) | Read; no defect found in the audio paths. Linux and Apple improvements are in [TODO.md](TODO.md) |
| Communication: Android client | TESTING | Queue trim, position-only save, read retries: built and unit-tested, not run on a device |
| Communication: Linux client | COMPLETED | 30 s timeout, bounded retries for reads |
| Communication: Apple client | BLOCKED | Never built; not changed |
| Communication: web client | COMPLETED | Timeouts, bounded retries with backoff and jitter, probe timeout |
| Communication: Windows client | COMPLETED | Bounded retries for reads |
| Communication: queue save | COMPLETED | Position-only `PATCH` on server, web and Windows |
| Performance measurements | COMPLETED | Proxy overhead measured; no proxy optimisation was warranted |
| Security review | COMPLETED | No finding that needed a change |
| UI/UX changes | COMPLETED | Considered; none needed ([ECHO-COMMUNICATION.md](ECHO-COMMUNICATION.md) §7) |
| Final QA | COMPLETED | [TESTING.md](TESTING.md) |
| Deploy, merge, release | BLOCKED | Waits for the owner's word |

## Summary

1. **A bug in the stream proxy, fixed.** ECHO ended a song's upstream request after 15 s in which
   the *listener* read nothing. A paused player with a full buffer is exactly that. A raw file
   could be resumed with a Range request; a transcoded one could not, and the song ended early.
   `src/server/navidrome/client.ts` now ends the request only when Navidrome itself is silent.
2. **The web client's API calls had no timeout and no retry.** `src/client/api.ts` now gives each
   call 45 s, and asks a read (GET) again twice at most, with exponential backoff and jitter, when
   the network dropped it, a proxy answered 502–504, or the API budget answered 429. A write is
   never sent twice. The Windows client's `Api.Send` does the same.
3. **The queue was uploaded whole every 15 s.** Up to 60 KB each time, though only the position
   had changed. A new `PATCH /api/v1/me/queue` moves the position alone, under the same
   compare-and-set as the `PUT`. Web, Windows and Android use it and fall back to `PUT`.
4. **Two suspected costs were measured and are not real.** The proxy builds its Subsonic client
   per request and checks the URL per request; both cost microseconds, and the upstream connection
   is reused. ECHO adds about 2–4 ms to a request on loopback. No caching was added.
5. **Android never trimmed its saved queue.** A queue over the server's 64 KB limit was refused and
   the error dropped, so a long queue was never saved. A unit test shows a 3,000-song queue is over
   the limit; `fitted()` now cuts it as web and Windows do. Not reproduced on a device.
6. **Security:** the controls were read and are sound. No dependency has a known vulnerability.

## Remaining

See [TODO.md](TODO.md). The first three: deploy and release (the owner's word); run the Android
changes on a device (they are built and unit-tested only); Linux and Apple fetch a signed URL before
every song (one round trip more than the others).

## For whoever continues

- `pnpm check` (typecheck, Biome, Vitest, build) and `pnpm test:e2e` for the server and web;
  `dotnet test Windows/Tests` for Windows; `./gradlew testDebugUnitTest` in `Android/`; `cargo test`
  in `Linux/`. Known E2E failures are listed in [TESTING.md](TESTING.md).
- `node scripts/bench-proxy.ts 100` repeats the proxy measurement.
- The machine this was written on is also the production server. The tests and the bench use their
  own ports (18787/18788, 18797/18798) and temp directories, and touch nothing that is live.
