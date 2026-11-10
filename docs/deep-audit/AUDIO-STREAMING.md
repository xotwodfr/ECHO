# Audio streaming

Status: server COMPLETED · web COMPLETED · Windows COMPLETED · Android, Linux, Apple BLOCKED (read,
not changed; see §6).

## 1. The path

ECHO stores and transcodes no audio. `GET /api/v1/navidrome/stream/:id`
(`src/server/navidrome/routes.ts:472`) asks Navidrome's `/rest/stream` with the user's own
credentials, forwards `Range`, and pipes the answer (`pipe()`, `Readable.toWeb`). Navidrome does any
transcoding. The diagram is in [ARCHITECTURE.md](ARCHITECTURE.md) §4.

| Client | Request | Format | Next song | A dropped stream |
|---|---|---|---|---|
| Web `src/client/playback/navidrome.ts` | `<audio src>` with the session cookie | raw when `canPlayType`, else Opus 192 | buffered in a second `<audio>` (gapless hand-over) | reloads at the position it reached, 500 ms × 2^n apart, a bounded number of times (REL-02) |
| Windows `Windows/App/Playback/` | Bearer, one request (`Api.Stream`) | raw when miniaudio decodes it, else MP3 320 | request answered and decoder opened ahead | `ProgressiveStream` asks again from the byte it reached, 5 times |
| Android `Android/.../playback/Playback.kt` | Bearer, `format=raw` | raw | Media3's own | Media3's own |
| Linux `Linux/src/api.rs` | signed URL fetched first | — | none | none |
| Apple `Apple/Shared/Api.swift` | signed URL fetched first | — | none | none (never run) |

All rows verified by reading. The Android, Linux and Apple rows were not exercised.

## 2. Found and fixed: a paused listener lost the stream

**Verified by test** (`src/server/navidrome/client.test.ts`, which fails without the fix).

`createClient().request()` set Node's socket `timeout` to 15 s and destroyed the request when it
fired. Node's timeout counts socket *activity*. When the listener stops reading, backpressure stops
ECHO reading from Navidrome, the socket goes quiet, and after 15 s ECHO itself cut a healthy
stream. In a script against a local server, a reader that paused got 65 KB of an 8 MB body and then
`aborted`.

Who stops reading: a browser's `<audio>` and ExoPlayer both stop when their buffer is full, and do
so for as long as a song is paused. (That browsers and ExoPlayer do this is general knowledge of
those players, not something measured here.)

What it cost: with a raw file the player asks again with `Range` and the listener may notice only a
short stall. With a transcode there is no `Range` (`Accept-Ranges: none`), so the song ended at
whatever was buffered, or had to be restarted with `timeOffset`.

The fix, in `src/server/navidrome/client.ts`:

```ts
req.on('timeout', () => {
  if (!res?.readableLength) req.destroy(new SubsonicError('timeout', 0));
});
```

Bytes ECHO holds unread mean the reader is the slow one. An empty buffer after 15 s of nothing
means Navidrome is silent, and the request still ends (second test in the same file). A server that
never answers still gives `timeout` (third test).

Is a connection held open for a paused listener a cost? One socket and at most one buffer's worth
of memory per paused song, and it closes when the listener leaves (§3). Before the fix it was cut
and reopened instead.

## 3. Verified: a listener that leaves closes the upstream request

`src/server/navidrome/stream.test.ts` runs ECHO on a real socket in front of a Subsonic server that
never stops sending, disconnects the listener, and sees the upstream response closed within 300 ms.
No change was needed. The test stays, because `app.request()` tests cannot show this.

## 4. Reviewed, no change

- **Time to first byte through the proxy:** measured, about 2–3 ms over a direct request on
  loopback ([PERFORMANCE.md](PERFORMANCE.md) §2). Nothing to gain there.
- **`cache-control: private, no-store` on streams:** deliberate (a user's audio does not belong in a
  shared cache). Left.
- **Streams are outside the API budget** (`UNMETERED`, `src/server/auth/routes.ts:136`), so a
  player's Range requests cannot be answered 429. Left.
- **Signed stream URLs** (`/stream-url/:id`): HMAC over account, song and expiry, compared with
  `timingSafeEqual`. Left.
- **YouTube** (`src/server/youtube/ytdlp.ts`): resolved URLs are cached, two yt-dlp processes at
  most, the next song is resolved ahead, failures are remembered briefly. Well tuned already.
- **Web player:** two voices for gapless hand-over, raw-first, reloads with backoff on error. No
  defect found.

## 5. Windows: retries back off

`ProgressiveStream.Fill` waited a fixed fifth of its quiet time (2 s) before each of 5 retries. It
now waits 0.5, 1, 2, 4, 8 s, each ×0.75–1.25
(`Windows/App/Playback/ProgressiveStream.cs`). The first retry comes sooner, the last ones leave a
network longer to return, and the count is unchanged. No timing is claimed for this: it was not
measured, and the existing streaming tests (`Windows/Tests/StreamingStartTests.cs`) pass unchanged.

## 6. Not done

- **Android**: `Playback.kt` was read, not changed. See [TODO.md](TODO.md) P1 for the queue save.
  Its audio path is Media3's and showed no defect in reading.
- **Linux, Apple**: one round trip more per song (the signed URL), no retry, no preparation of the
  next song. The Apple client has never been built; changing it blind would be guessing.
- **Real network conditions** (loss, latency, a phone changing networks) were not tested. Every
  measurement here is loopback.
