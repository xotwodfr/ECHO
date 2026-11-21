# echo-motion

ECHO's motion service for the iPhone's animated lock-screen covers (../docs/MOTION.md). It makes a
looping video from an album's still cover, or converts a video an admin uploaded, and serves the
results. Only the ECHO server talks to it, on an internal Docker network.

- `motion.py`: the renderer. Two styles, chosen per cover by a rule (`features()`, `classify()`):
  **Depth** for photographs (Depth Anything V2 Small on ONNX Runtime estimates depth; near and far
  move apart in a slow orbit) and **Living light** for flat or text-heavy art (light in the cover's
  own colours drifts over it, a soft diagonal sweep crosses it, blended as soft light). One
  1440 × 1440 render of the square cover gives the tall video (its middle 1080 columns, 3:4) and
  the square one; every motion is periodic in the loop's phase, so the loop has no seam. Also
  `transcode()` for uploads. OpenCV, NumPy and ffmpeg; no PyTorch.
- `server.py`: the HTTP service. Standard library plus the above.

| Request                                   | Answer                                                              |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `PUT /render/{key}?loop=8[&style=]`       | The body is the cover (JPEG, PNG, WebP; anything ffmpeg reads). `loop` is 5, 8, 12 or 15 s; `style` `auto` (the rule), `depth` or `light`. It answers once done: `200 {"bytes","seconds","style","took","features"}`, or `422` if it can't be read |
| `PUT /transcode/{key}`                    | The body is a video (MP4 or QuickTime, at most 60 s). `200 {"bytes","seconds","style":"video","took"}`, or `422 {"error":"bad_video","detail"}` saying what is wrong |
| `GET /motion/{key}/{tall,square}.{mp4,jpg}` | The videos (HEVC or H.264, no sound) and their first frames. Range works |
| `HEAD /motion/{key}/{name}`               | `200` if it exists, `404` if not                                    |
| `DELETE /motion/{key}`                    | `200 {"deleted": n}`: ECHO's cache cap lets a cover go               |
| `GET /stats`                              | `{"covers", "bytes", "working"}`                                    |
| `GET /health`                             | `{"ok": true}`                                                      |

Files are written to `$ECHO_MOTION_DIR/{key[:2]}/{key}-{name}` (default `/motion`). Each is written
to a temporary name and renamed once all four are done, so a half-made cover is never served.

Run it outside Docker (Python 3.10+, ffmpeg with libx265 on the PATH):

```bash
pip install -r requirements.txt
ECHO_MOTION_DIR=./out ECHO_MOTION_MODEL=./depth-anything-v2-small.onnx python server.py
```

Tune the rule on your own covers, or preview a cover, by hand:

```bash
python motion.py classify --model depth-anything-v2-small.onnx covers/*.jpg   # features and style, one JSON line each
python motion.py render --model depth-anything-v2-small.onnx --out previews --loop 8 cover.jpg
```

Tests (`pip install -r requirements-dev.txt`): `python -m pytest motion` from the repository root
(CI's `motion` job). They need no model: a stand-in depth map takes its place, and
`ECHO_MOTION_MODEL=<file>` adds a test with the real one.
