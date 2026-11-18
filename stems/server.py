"""ECHO's stem service (stems/README.md): splits songs into instrumental and vocals for Karaoke
mode, and serves the results. ECHO (the server) is its only client; it is not published.

  PUT  /separate/{key}   body: the song (any format ffmpeg reads) -> 200 {"bytes": n, "seconds": s}
  GET  /stems/{key}      the result: AAC 5.1 in MP4, instrumental front left/right, vocals rear
                         left/right, centre and LFE silent; Range requests work
  HEAD /stems/{key}      200 if it exists, 404 if not
  GET  /stats            {"songs": n, "bytes": n, "working": key or null}

One song at a time, at the lowest CPU priority, on ECHO_STEMS_THREADS threads (default 2).
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

from separate import SR, Separator

OUT = os.environ.get("ECHO_STEMS_DIR", "/stems")
MODEL = os.environ.get("ECHO_STEMS_MODEL", "/models/UVR-MDX-NET-Inst_HQ_3.onnx")
THREADS = int(os.environ.get("ECHO_STEMS_THREADS", "2"))
BITRATE = os.environ.get("ECHO_STEMS_BITRATE", "224k")
MAX_BYTES = 2_000_000_000  # a song, not a disk image
KEY = re.compile(r"^[A-Za-z0-9._-]{1,200}$")

os.nice(19)
separator = None
lock = threading.Lock()  # one song at a time
working = None


def path_of(key):
    return os.path.join(OUT, key[:2], key + ".m4a")


def decode(src):
    """Any audio file -> float32 [2, n] at 44.1 kHz."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", src, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy()


def encode(inst, vocals, dest):
    """Instrumental and vocals -> one AAC 5.1 file (FL FR = instrumental, BL BR = vocals)."""
    n = inst.shape[1]
    six = np.zeros((n, 6), dtype=np.float32)  # FL FR FC LFE BL BR
    six[:, 0], six[:, 1] = inst[0], inst[1]
    six[:, 4], six[:, 5] = vocals[0], vocals[1]
    np.clip(six, -1, 1, out=six)
    tmp = dest + ".part.m4a"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "6", "-channel_layout", "5.1",
         "-i", "-", "-c:a", "aac", "-b:a", BITRATE, "-movflags", "+faststart", tmp],
        input=six.tobytes(), check=True, capture_output=True,
    )
    os.replace(tmp, dest)


def separate(key, body_path):
    global separator, working
    with lock:
        working = key
        try:
            if separator is None:
                separator = Separator(MODEL, threads=THREADS)
            t = time.time()
            mix = decode(body_path)
            inst = separator.instrumental(mix)
            dest = path_of(key)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            encode(inst, mix - inst, dest)
            return os.path.getsize(dest), time.time() - t
        finally:
            working = None


def stats():
    songs, size = 0, 0
    for root, _, files in os.walk(OUT):
        for f in files:
            if f.endswith(".m4a") and not f.endswith(".part.m4a"):
                songs += 1
                size += os.path.getsize(os.path.join(root, f))
    return {"songs": songs, "bytes": size, "working": working}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _key(self, prefix):
        key = self.path[len(prefix):].split("?")[0]
        return key if KEY.match(key) else None

    def do_PUT(self):
        key = self._key("/separate/") if self.path.startswith("/separate/") else None
        if not key:
            return self._json(404, {"error": "not_found"})
        chunked = "chunked" in (self.headers.get("transfer-encoding") or "").lower()
        length = int(self.headers.get("content-length") or 0)
        if not chunked and (length <= 0 or length > MAX_BYTES):
            return self._json(400, {"error": "bad_body"})
        with tempfile.NamedTemporaryFile(dir=OUT, suffix=".src", delete=False) as f:
            src = f.name
            try:
                total = self._copy_chunked(f) if chunked else self._copy(f, length)
            except ValueError:
                total = -1
        if total <= 0:
            os.unlink(src)
            return self._json(400, {"error": "bad_body"})
        try:
            size, seconds = separate(key, src)
            self._json(200, {"bytes": size, "seconds": round(seconds, 1)})
        except Exception as e:  # a song ffmpeg can't read, or a model failure
            print(f"separate {key}: {e}", file=sys.stderr, flush=True)
            self._json(422, {"error": "separation_failed"})
        finally:
            os.unlink(src)

    def _copy(self, f, length):
        left = length
        while left:
            chunk = self.rfile.read(min(left, 1 << 20))
            if not chunk:
                return -1  # the sender went away
            f.write(chunk)
            left -= len(chunk)
        return length

    def _copy_chunked(self, f):
        total = 0
        while True:
            size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
            if size == 0:
                while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                    pass  # trailers
                return total
            total += size
            if total > MAX_BYTES:
                raise ValueError("too large")
            left = size
            while left:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    raise ValueError("cut off")
                f.write(chunk)
                left -= len(chunk)
            self.rfile.readline()

    def _serve(self, head):
        key = self._key("/stems/")
        p = path_of(key) if key else None
        if not p or not os.path.exists(p):
            return self._json(404, {"error": "not_found"})
        size = os.path.getsize(p)
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("range") or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("content-range", f"bytes */{size}")
                self.send_header("content-length", "0")
                return self.end_headers()
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header("content-range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("content-type", "audio/mp4")
        self.send_header("accept-ranges", "bytes")
        self.send_header("content-length", str(end - start + 1))
        self.end_headers()
        if head:
            return
        with open(p, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left:
                chunk = f.read(min(left, 1 << 16))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def do_HEAD(self):
        if self.path.startswith("/stems/"):
            return self._serve(True)
        self._json(404, {"error": "not_found"})

    def do_GET(self):
        if self.path.startswith("/stems/"):
            return self._serve(False)
        if self.path == "/stats":
            return self._json(200, stats())
        if self.path == "/health":
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not_found"})


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    port = int(os.environ.get("ECHO_STEMS_PORT", "8090"))
    print(f"echo-stems on :{port}, {THREADS} threads, writing to {OUT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
