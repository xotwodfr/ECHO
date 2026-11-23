# Animated lock-screen covers

On the iPhone, the lock screen can show a short looping video for the playing song instead of its
still cover: full screen and tall (3:4), or square, with a still of its first frame until the video
plays (iOS 26, `MPMediaItemAnimatedArtwork`). ECHO's server makes these "motion covers" for every
album, and the iPhone app shows them (`docs/superpowers/specs/2026-11-19-apple-apps-design.md`,
"Animated lock-screen covers"; the app's side is task 5 of the plan).

- **An admin's video, when there is one.** In the web app, an album's ⋯ menu has **Upload motion
  cover…** for admins: an MP4, M4V or QuickTime video, up to 50 MB and 60 s. It becomes the album's
  motion cover for everyone on that Navidrome server. **Remove motion cover** takes it away again.
- **Otherwise ECHO makes one** from the album's cover, the first time it is asked for (the album's
  first play on an iPhone), and keeps it. Until it is ready the lock screen shows the still cover.
- **The whole tall frame moves.** The square cover fills the 3:4 frame (cropped at the sides) and the
  motion plays across all of it; the square version is the whole cover.

## The two motions

Chosen per cover, by a rule (below). The owner chose them after previews on four of his own covers.

- **Depth**, for photographs. Depth Anything V2 Small estimates how far each part of the cover is;
  near and far then move apart in a slow orbit, with a gentle breath of zoom. The depth map is
  smoothed hard (a Gaussian of 30 px on the 1440 px cover) and the orbit is small (2.2 % of the tall
  frame's width), or printed lettering bends.
- **Living light**, for flat or text-heavy art. The cover holds still. Light in its own colours (the
  three most vivid of its palette) drifts over it, and a soft diagonal sweep crosses once per loop.
  The light is blended as soft light, so the cover keeps its contrast (a screen blend turns it
  milky).

Both loop without a seam: every motion is periodic in the loop's phase, so the frame after the last
is the first again (`motion/test_motion.py` checks the encoded video). Both have a light vignette
for the clock and controls over them.

### The rule

`motion/motion.py` (`features`, `classify`) looks at the cover at 512 px and, for a photograph, at
its depth map:

| Feature | What it measures | Flat art | Photographs |
| --- | --- | --- | --- |
| `even` | the share of the cover in even areas (5 × 5 neighbourhoods within 1.5 levels) | 0.67–0.97 | 0.12–0.52 |
| `tones` | luminance entropy, in bits | 1.3–2.6 (6.2 for a smooth gradient) | 6.6–7.5 |
| `edges` | the share on hard, high-contrast edges (lettering, line art) | 0.035–0.17 | under 0.015 |
| `depth` | the spread (standard deviation) of the estimated depth, 0–1 | — | 0.24–0.36 |

It picks **Living light** when `even` ≥ 0.65 (flat fills), `edges` > 0.07 (text-heavy), `tones` <
5 bits (few tones) or `depth` < 0.12 (nothing to move apart), and **Depth** otherwise. The model only
runs when the first three say "photograph". The photograph ranges are the owner's four covers (all
photographs, two of them with large titles: all four get Depth); the flat ones synthetic posters,
type and illustrations (`test_motion.py`). To tune it on a library:

```bash
python motion/motion.py classify --model depth-anything-v2-small.onnx /music/**/cover.jpg
```

prints each cover's features and the style it gets; the thresholds are the constants at the top of
`motion.py`. `python motion/motion.py render …` makes a cover's motion cover by hand, to look at.

## Speed

The loop's length is a setting in the apps (their speed): 5, 8, 12 or 15 seconds, 8 by default. The
motion is the same, done over a longer or shorter loop. Each length is its own cover, made the first
time it is asked for; a small fixed set keeps the cache bounded. An uploaded video plays at its own
length whatever the setting.

## How it works

```
 app ──GET /api/v1/motion/{album}?shape&loop──▶ ECHO ──queue (SQLite motion_jobs)──▶ one cover at a time
  ▲                                              │                                     │ the cover (getCoverArt 1440)
  │   202 + Retry-After until ready               │                                     │ or the uploaded video
  │                                              │                                     ▼
  └── /api/v1/motion/{album}/video, /still ◀─────┴── GET /motion/{key}/… ◀── echo-motion (motion/): PUT /render, /transcode
```

- **The motion service** (`motion/`, `echo-motion`) renders one 1440 × 1440 square of the moving
  cover per frame (30 fps) with OpenCV and NumPy, and encodes the tall video (its middle 1080
  columns: 1080 × 1440) and the square one (1080 × 1080) at once, then takes each one's first frame
  as a JPEG. Depth runs on ONNX Runtime on the CPU. One cover at a time, at the lowest priority
  (`nice 19`), on `ECHO_MOTION_THREADS` threads.
- **The files** are MP4, HEVC (`hvc1`, as AVFoundation plays it) by default or H.264
  (`ECHO_MOTION_CODEC=h264`), 4:2:0, no sound.
- **An upload** is checked by ECHO (an admin, the Content-Type, the size, and its first bytes: an
  MP4/QuickTime container with a video brand), kept in `/data/motion`, recorded
  (`motion_uploads`) and audited (`admin.motion_uploaded`, `admin.motion_removed`). The motion
  service then checks it with ffprobe (a video stream, at most 60 s) and converts it: the frame
  filled (cropped, never letterboxed) to 3:4 and to square, at most 30 fps, without sound. A video
  it refuses (too long, unreadable) leaves the album to a generated cover meanwhile, and the admin
  sees why in the album's menu. An upload replaces the album's generated covers.
- **The queue** is in ECHO, like Karaoke's: uploads first, then covers in the order asked for. A
  cover is made once per Navidrome server, album and loop length. One that fails for a passing
  reason is tried again after 10 and then 20 minutes; one the service cannot use (no cover, an
  image nothing reads) fails at once, and is tried again when asked for a week later. If the
  service is down, the queue waits. One user can have at most 20 covers waiting.
- **The cache:** what generated covers take on the service's disk is capped
  (`ECHO_MOTION_CACHE_MB`, 2 GB); past it, the covers asked for longest ago go first, and are made
  again if asked for. Uploads are not counted and never go.
- **Serving:** the video and the still go to a session or a device token, like covers, outside the
  per-user API budget; Range works; `Cache-Control: private, max-age=86400` with an ETag (a client
  asking again with `If-None-Match` gets 304). The status's `version` changes when a cover is made
  again or replaced.

### The API (docs/api/openapi.yaml)

| Request | Answer |
| --- | --- |
| `GET /motion/{album}?shape=tall\|square&loop=5\|8\|12\|15` | `200 {status: "ready", source, style, seconds, version, video, still}`; `202 {status: "queued"\|"working", ahead, retryAfter}` with `Retry-After` while it is made (asking queues it; the app shows the still cover meanwhile); `200 {status: "failed"}` or `{status: "off"}` |
| `GET /motion/{album}/video?shape&loop` | The MP4 (Range, ETag), or 202 as above, 404 when off or failed |
| `GET /motion/{album}/still?shape&loop` | Its first frame, a JPEG |
| `GET /motion/{album}/upload` | Admins: the album's upload and how its conversion went |
| `PUT /motion/{album}/upload` | Admins: the video as the body (`video/mp4`, `video/quicktime`, `video/x-m4v`), at most 50 MB → 201 |
| `DELETE /motion/{album}/upload` | Admins: removes it |
| `GET /motion` | `{enabled, online, ready, queued, failed, uploads, bytes, cacheBytes, loops}` |

## Setting it up

Add the `echo-motion` service, its `echo-motion` volume and the `motion` network from
`compose.example.yaml`, add `motion` to ECHO's networks (and leave its other networks as they are,
as for Karaoke: `docs/KARAOKE.md`), and set `ECHO_MOTION_URL: http://echo-motion:8091` on ECHO. Then
`docker compose up -d --build`. The first build downloads Depth Anything V2 Small as ONNX (99 MB,
`onnx-community/depth-anything-v2-small` at a pinned revision, checked against its SHA-256; the
model is Apache-2.0).

| Variable (ECHO) | Default | Meaning |
| --- | --- | --- |
| `ECHO_MOTION_URL` | unset | The motion service; unset turns motion covers off |
| `ECHO_MOTION_CACHE_MB` | `2048` | What generated covers may take on the service's disk |

| Variable (echo-motion) | Default | Meaning |
| --- | --- | --- |
| `ECHO_MOTION_THREADS` | `2` | CPU threads for OpenCV, the model and each encoder |
| `ECHO_MOTION_CODEC` | `hevc` | `h264` for H.264 (about 3× the size, a little faster to encode) |
| `ECHO_MOTION_DIR` | `/motion` | Where the covers are kept |
| `ECHO_MOTION_MODEL` | the image's | The depth model; without it every cover gets Living light |

## What to expect

Measured 2026-11-19 on a 4-core Intel Xeon at 2.3 GHz (`nproc` 4), with other jobs running beside
it, mostly in the built image run as the compose example runs it; one album, both shapes and both
stills:

| Loop | Living light | Depth | On disk |
| --- | --- | --- | --- |
| 8 s, HEVC, the image at `cpus: 2` (the compose example) | 26 s | 21 s | 0.55–0.8 MB |
| 8 s, HEVC, the image at 4 CPUs, `ECHO_MOTION_THREADS=4` | 18–20 s | 17 s | 0.55–0.8 MB |
| 8 s, H.264, 4 cores (outside Docker) | 15 s | 14 s | 2.4–3.4 MB |
| 15 s, HEVC, 4 cores (outside Docker) | 42 s | 31 s | 1.1 MB |
| An upload: 10 s of 1080p, at `cpus: 2` | 23 s | | 11 MB (a busy test pattern) |

- **Per album:** about 20–25 seconds for the default 8-second loop at the compose example's two
  CPUs, under 20 with four, so an album played on the iPhone has its motion cover well before its
  first song ends. The time grows with the loop's length. With the instruction sets an i7-3770
  lacks (AVX2, FMA, AVX-512) turned off, renders took about as long (14–19 s at 4 cores outside
  Docker); the OptiPlex's older cores may still be slower per clock, so budget up to about twice
  that there.
- **Memory:** about 0.45–0.55 GB while it works (the depth model and two encoders); the compose
  example allows 2 GB.
- **Disk:** about 0.8 MB per album and loop length in HEVC (both videos 0.55 MB, the two stills
  0.2 MB); the 2 GB cap holds about 2,500. Uploads take what they take, plus their conversion.
- **The image** is 1.5 GB (Python, ONNX Runtime, OpenCV, ffmpeg and the model).
- **Nothing in the background:** covers are made only when asked for, never for the whole library.
