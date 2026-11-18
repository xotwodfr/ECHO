# Karaoke mode

Turn the singer down, or off, in any song from the library. The vocals slider on Now Playing and
in the lyrics view sets how much of the voice is left: 0 % is the instrumental, 100 % the song as
it was. You can change it at any time without a gap, because both parts are in one file.

## How it works

```
 app ──GET /api/v1/karaoke/{id}──▶ ECHO ──queue (SQLite stems_jobs)──▶ worker, one song at a time
  ▲                                  │                                   │ song from Navidrome (raw)
  │                                  │                                   ▼
  └──── /api/v1/karaoke/{id}/audio ◀─┴──── GET /stems/{key} ◀──── echo-stems (stems/), PUT /separate/{key}
```

- **The stem service** (`stems/`) runs UVR-MDX-NET-Inst_HQ_3, an MDX-Net model from the Ultimate
  Vocal Remover project, with ONNX Runtime on the CPU. It uses two threads at the lowest priority
  (`nice 19`) and works on one song at a time. Its output matches the reference implementation,
  audio-separator (correlation 1.000 on the test song).
- **The file** is AAC 5.1 in MP4 at 224 kbps. The instrumental is on front left/right, the vocals
  on rear left/right, and centre and LFE are silent. The app mixes
  `instrumental + level × vocals` itself. A 4-minute song takes about 6.7 MB.
- **The queue** is in ECHO, and a song is made once per Navidrome server. Jobs run in this order:
  1. The song someone is playing (`priority 10`).
  2. The next songs in their queue (`?soon=1`, priority 5).
  3. The whole library (priority 0). It is queued five minutes after start, then daily for new
     songs.

  A song that fails is tried again after 10 and then 20 minutes, then reported `failed`. Songs
  longer than `ECHO_STEMS_MAX_MINUTES` (20) are `skipped`. If the stem service is down, the queue
  just waits.

## Setting it up

Add the `echo-stems` service and the `stems` network from `compose.example.yaml`, and set
`ECHO_STEMS_URL: http://echo-stems:8090` on ECHO. Then:

```bash
sudo mkdir -p /Media/Media/Instrumentals && sudo chown 1000:1000 /Media/Media/Instrumentals
docker compose up -d --build
```

The first build downloads the model (67 MB, checked against its SHA-256).

| Variable (ECHO)          | Default | Meaning                                              |
| ------------------------ | ------- | ---------------------------------------------------- |
| `ECHO_STEMS_URL`         | unset   | The stem service; unset turns Karaoke mode off       |
| `ECHO_STEMS_LIBRARY`     | `1`     | `0`: only songs someone plays, not the whole library |
| `ECHO_STEMS_MAX_MINUTES` | `20`    | Longer songs are skipped (memory)                    |

| Variable (echo-stems) | Default | Meaning                                      |
| --------------------- | ------- | -------------------------------------------- |
| `ECHO_STEMS_THREADS`  | `2`     | CPU threads for the model                    |
| `ECHO_STEMS_BITRATE`  | `224k`  | AAC bitrate of the 5.1 file (`160k` saves 30 %) |

## What to expect

- **Speed:** on two CPU cores, a song takes about as long to split as it does to play. A song you
  start is usually ready a few minutes in. The app plays the original until then and switches over
  at the same position.
- **The whole library:** budget roughly one day of splitting for each day of music. A 700 GB FLAC
  library is about 1,700 hours, so it takes about 2½ months in the background. Songs that are
  played always jump ahead.
- **Disk:** about 1/4 of the FLAC size at 224 kbps. 700 GB of FLAC needs about 170 GB, or about
  120 GB at `160k`.
- **New music:** once Navidrome has scanned a new song, ECHO's daily sweep queues it, starting
  five minutes after ECHO starts and then every 24 hours. A song someone plays with Karaoke on
  is asked for at once.
- **Memory:** the service reads the song from disk a chunk at a time. The model costs about
  1.3 GB, and a 12-minute song peaked at 1.9 GB in all (measured), so the 3 GB limit in the
  compose example covers the 20-minute maximum.
- **Failures:** a song that fails is tried three times. Failed songs are tried again when ECHO
  restarts and a week later, in case the service was fixed in between.
- **Progress:** `GET /api/v1/karaoke` reports ready, queued, failed and skipped songs and the bytes
  on disk. The app shows this in Settings → Karaoke.
