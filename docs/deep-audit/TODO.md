# What remains

By priority. Each item says how sure the finding is.

## P1

1. **Deploy** the server and web changes, and release Windows and Android, when the owner says so.
   Until the server is deployed, a new client's `PATCH` gets 404 and falls back to `PUT` (tested on
   web and Windows; the same code path on Android is not covered by a test).
2. **Android: run the new save on a device.** The queue trim, the position-only save and the read
   retries build and their pure parts are unit-tested, but the app was not run: the emulator on
   this machine is unreliable. Check: play a long list (thousands of songs), pause, open the web —
   the queue and position should be there.

## P2

3. **Apple: bounded retry of reads**, with the policy of
   [ECHO-COMMUNICATION.md](ECHO-COMMUNICATION.md) §2. The client has never been built; start there.
4. **Linux, Apple: one request per song** instead of two, if their players can send a header
   (GStreamer's `souphttpsrc` has `extra-headers`; AVPlayer needs `AVURLAsset` options). Saves one
   round trip before each song. Not measured.
5. **Linux, Apple: make the next song ready** ahead, as Windows does.
6. **Is production's Navidrome URL a hostname?** If so, measure the DNS lookup per proxied request
   ([PERFORMANCE.md](PERFORMANCE.md) §3) before deciding on a cache.

## P3

7. **Test under real network faults** (loss, latency, a network change mid-song). Everything in
   this audit ran on loopback.
8. **The Apple client has never been built.** Any work on it starts with building it.
9. **Dependency updates** (patch/minor, listed in [SECURITY.md](SECURITY.md) §2), as their own
    change.
10. **The flaky screenshot** `Listen stage, Ambient frame, at 390` (fails about half the time on the base commit too; [TESTING.md](TESTING.md) §3): fix or list as known.
11. **Biome's 20 warnings** were there before the audit and are still there.
12. **The five clients share no code.** Not proposed to change; the table in
    [ECHO-COMMUNICATION.md](ECHO-COMMUNICATION.md) §6 is the checklist that keeps them level.

## Considered and dropped

- A cache for the Subsonic client or the URL check in the proxy: measured, no cost to remove.
- An `AbortController` per page load on the web: `useFresh` already discards late answers.
- A "retrying…" indicator, a diagnostics page: no need shown.
- Retrying writes with idempotency keys: the writes that matter (the queue) already have
  compare-and-set and are sent again by the next save.
