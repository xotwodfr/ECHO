# echo-stems

ECHO's stem service for Karaoke mode (../docs/KARAOKE.md). It splits a song into instrumental and
vocals and serves the result. Only the ECHO server talks to it, on an internal Docker network.

- `separate.py`: the separator. It runs UVR-MDX-NET-Inst_HQ_3 (Ultimate Vocal Remover project, MIT)
  with ONNX Runtime and does the STFT in NumPy, so it needs no PyTorch.
- `server.py`: the HTTP service. It uses only the standard library plus ffmpeg.

| Request                | Answer                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| `PUT /separate/{key}`  | The body is the song in any format ffmpeg reads (a length, or chunked). It answers once done: `200 {"bytes","seconds"}`, or `422` if it can't be read |
| `GET /stems/{key}`     | AAC 5.1 in MP4. Instrumental is front L/R, vocals rear L/R. Range works |
| `HEAD /stems/{key}`    | `200` if the song exists, `404` if not                              |
| `GET /stats`           | `{"songs", "bytes", "working"}`                                     |
| `GET /health`          | `{"ok": true}`                                                      |

Files are written to `$ECHO_STEMS_DIR/{key[:2]}/{key}.m4a` (default `/stems`). Each is written to
a temporary name and then renamed, so a half-written file is never served.

Run it outside Docker (Python 3.10+, ffmpeg on the PATH):

```bash
pip install -r requirements.txt
ECHO_STEMS_DIR=./out ECHO_STEMS_MODEL=./UVR-MDX-NET-Inst_HQ_3.onnx python server.py
```
