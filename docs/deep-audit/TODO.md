# What remains

By priority. Each item says how sure the finding is.

## P1

1. **Android: the saved queue is never trimmed to the server's limit.**
   `Android/app/src/main/kotlin/com/folk3s/echo/playback/Playback.kt` `save()` sends the whole
   context; the server refuses bodies over 64 KB (`BODY_LIMIT`), and `save()` returns silently on
   any error but 409. So with a long queue (the web's own test uses 3,000 songs) the queue would
   never be saved from Android. *Found by reading; not reproduced on a device or emulator.* Fix:
   the same halving as `trimQueue` (`src/client/playback/queueSync.ts`) and `Fitted`
   (`Windows/App/Playback/Player.cs`); reproduce first.
2. **Android: position-only save.** `save()` PUTs the whole queue every time. Use
   `PATCH /me/queue` with the fallback, as web and Windows do.
3. **Deploy** the server and web changes, and release Windows, when the owner says so. Until the
   server is deployed, a new Windows client's `PATCH` gets 404 and falls back to `PUT` (tested).

## P2

4. **Android, Linux, Apple: bounded retry of reads**, with the policy of
   [ECHO-COMMUNICATION.md](ECHO-COMMUNICATION.md) §2. Android: an OkHttp interceptor.
5. **Linux, Apple: one request per song** instead of two, if their players can send a header
   (GStreamer's `souphttpsrc` has `extra-headers`; AVPlayer needs `AVURLAsset` options). Saves one
   round trip before each song. Not measured.
6. **Linux, Apple: make the next song ready** ahead, as Windows does.
7. **Is production's Navidrome URL a hostname?** If so, measure the DNS lookup per proxied request
   ([PERFORMANCE.md](PERFORMANCE.md) §3) before deciding on a cache.

## P3

8. **Test under real network faults** (loss, latency, a network change mid-song). Everything in
   this audit ran on loopback.
9. **The Apple client has never been built.** Any work on it starts with building it.
10. **Dependency updates** (patch/minor, listed in [SECURITY.md](SECURITY.md) §2), as their own
    change.
11. **The flaky screenshot** `Listen stage, Ambient frame, at 390` (fails about half the time on the base commit too; [TESTING.md](TESTING.md) §3): fix or list as known.
12. **Biome's 20 warnings** were there before the audit and are still there.
13. **The five clients share no code.** Not proposed to change; the table in
    [ECHO-COMMUNICATION.md](ECHO-COMMUNICATION.md) §6 is the checklist that keeps them level.

## Considered and dropped

- A cache for the Subsonic client or the URL check in the proxy: measured, no cost to remove.
- An `AbortController` per page load on the web: `useFresh` already discards late answers.
- A "retrying…" indicator, a diagnostics page: no need shown.
- Retrying writes with idempotency keys: the writes that matter (the queue) already have
  compare-and-set and are sent again by the next save.
