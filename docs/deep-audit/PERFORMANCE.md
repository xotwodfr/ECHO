# Performance

Status: COMPLETED. Every number here came from a run on 2026-11-10 on the development machine
(Dell OptiPlex, i7-3770, which is also the production host and was serving at the time). Nothing
was measured over a real network, on the production server, or on a phone.

## 1. How

`scripts/bench-proxy.ts` starts a real ECHO server (port 18797, its own temp data directory and
master key) and the test Subsonic server (`src/server/navidrome/mock.ts`, port 18798), signs a user
in, and sends each request 120 times straight to the mock and 120 times through ECHO, on kept-alive
connections, 105 ms apart (inside the API budget). The first 20 of each are discarded. Run:

```
node scripts/bench-proxy.ts 100
```

What it shows: the work ECHO itself adds to a request. What it does not show: Navidrome's real
speed (the mock answers from memory), TLS, Caddy, or any network.

## 2. Measured: what the proxy adds

Milliseconds, median / 95th percentile, 100 requests each.

**Before any change**

| Request | Direct to mock | Through ECHO | Body |
|---|---|---|---|
| ping | 1.82 / 2.38 | 4.68 / 5.35 | 120 B |
| getAlbum | 1.73 / 2.00 | 4.69 / 5.25 | 1.6 KB |
| getAlbumList2 ×500 | 2.29 / 3.95 | 6.57 / 8.21 | 62 KB |
| cover | 4.04 / 4.46 | 6.86 / 7.81 | 816 B |
| stream, first byte | 1.58 / 2.43 | 3.67 / 5.19 | — |

**After all changes**

| Request | Direct to mock | Through ECHO | Body |
|---|---|---|---|
| ping | 1.76 / 2.28 | 4.75 / 5.93 | 120 B |
| getAlbum | 1.66 / 2.33 | 4.63 / 5.13 | 1.6 KB |
| getAlbumList2 ×500 | 2.85 / 4.23 | 7.01 / 7.66 | 62 KB |
| cover | 4.02 / 4.41 | 5.12 / 7.45 | 816 B |
| stream, first byte | 1.54 / 2.35 | 4.22 / 5.51 | — |

Reading: ECHO adds about 2–4 ms to a request. The two runs differ by less than the run-to-run
spread of a machine that was doing other work; **no speed-up or slow-down is claimed between
them**, and none was expected, because no change was made to this path's work. The table is here
as the baseline for whoever changes it next.

## 3. Hypotheses, tested and dropped

Each looked like a cost in reading. Each was timed with a short script before anything was changed.

| Hypothesis | Measured | Decision |
|---|---|---|
| The proxy checks the Navidrome URL on every request (`checkUrl`, DNS) | 0.026 ms a call for a URL that is an IP address | No cache added |
| A new Subsonic client per request means a new connection per request | 200 calls used 1 connection (Node's global agent keeps it alive) | No pool added |
| `client.call` (sign, request, parse, check) is slow | 0.55 ms a call against the local mock | Left |
| The JSON is parsed and written again in the proxy | Not timed separately; inside the 2–4 ms above | Left |

**Assumption, not checked:** the `checkUrl` figure is for an IP-address URL. If production's
Navidrome URL is a hostname, each request also does a DNS lookup. Production's configuration could
not be read during this audit (the read was refused by the session's safety policy, and that was
respected). If it is a hostname and lookups show up in a profile, a short-lived cache of the pinned
address in `src/server/navidrome/url.ts` is the place — but only with a measurement.

## 4. Changes that reduce work, without a timing claim

- **Queue save:** the periodic save sends two numbers instead of the queue (up to 60 KB). The
  saving is in bytes uploaded and in the JSON the server parses and stores, every 15 s per playing
  device. It was not timed. ([ECHO-COMMUNICATION.md](ECHO-COMMUNICATION.md) §4)
- **Stream no longer cut for a paused listener:** saves the reconnect and, for a transcode, the
  restart. A correctness fix first. ([AUDIO-STREAMING.md](AUDIO-STREAMING.md) §2)

## 5. Not measured

Web bundle size and page rendering (there is an existing `tests/e2e/perf.spec.ts`; it was run with
the rest of the E2E suite, not extended); Windows start-up and memory; anything on Android; SQLite
under load (one household's worth of users makes this an unlikely bottleneck — an assumption).
