"""ECHO's motion service (motion/README.md): animated lock-screen covers (docs/MOTION.md), made
from an album's still cover or from a video an admin uploaded, and served. ECHO (the server) is its
only client; it is not published.

  PUT    /render/{key}?loop=8[&style=auto|depth|light]   body: the cover (an image)
           -> 200 {"bytes", "seconds", "style", "took", "features"}; 422 if it can't be read
  PUT    /transcode/{key}                               body: the video (MP4 or QuickTime)
           -> 200 {"bytes", "seconds", "style": "video", "took"}; 422 {"error", "detail"}
  GET    /motion/{key}/{tall|square}.{mp4|jpg}          the files; Range requests work
  HEAD   /motion/{key}/{name}                           200 if it exists, 404 if not
  DELETE /motion/{key}                                  -> 200 {"deleted": n}
  GET    /stats                                         {"covers", "bytes", "working"}
  GET    /health                                        {"ok": true}

One cover at a time, at the lowest CPU priority, on ECHO_MOTION_THREADS threads (default 2).
"""

import json
import os
import re
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import motion  # first: it bounds the image size OpenCV decodes

import cv2  # noqa: E402

OUT = os.environ.get("ECHO_MOTION_DIR", "/motion")
MODEL = os.environ.get("ECHO_MOTION_MODEL", "/models/depth-anything-v2-small.onnx")
THREADS = max(1, int(os.environ.get("ECHO_MOTION_THREADS", "2")))
CODEC = "h264" if os.environ.get("ECHO_MOTION_CODEC", "hevc") == "h264" else "hevc"
MAX_IMAGE = 30_000_000  # a cover
MAX_VIDEO = 60_000_000  # ECHO takes 50 MB uploads
KEY = re.compile(r"^[A-Za-z0-9_-]{1,128}$")  # no dots: never a path out of OUT
NAMES = ("tall.mp4", "square.mp4", "tall.jpg", "square.jpg")
TYPES = {"mp4": "video/mp4", "jpg": "image/jpeg"}

os.nice(19)
cv2.setNumThreads(THREADS)
lock = threading.Lock()  # one cover at a time
depth_model = None
working = None


def path_of(key, name):
    return os.path.join(OUT, key[:2], f"{key}-{name}")


def outputs(key):
    """Where a cover's four files are written first (renamed into place once all are done)."""
    os.makedirs(os.path.join(OUT, key[:2]), exist_ok=True)
    names = {"tall": "tall.mp4", "square": "square.mp4", "tall_jpg": "tall.jpg", "square_jpg": "square.jpg"}
    return {k: path_of(key, n) + ".part" for k, n in names.items()}


def publish(paths):
    for p in paths.values():
        os.replace(p, p[: -len(".part")])
    return sum(os.path.getsize(p[: -len(".part")]) for p in paths.values())


def discard(paths):
    for p in paths.values():
        if os.path.exists(p):
            os.unlink(p)


def model():
    global depth_model
    if depth_model is None and os.path.exists(MODEL):
        depth_model = motion.DepthModel(MODEL, threads=THREADS)
    return depth_model


def make(key, job):
    """Runs [job](paths) under the lock with the files' temporary names; publishes on success."""
    global working
    with lock:
        working = key
        paths = outputs(key)
        try:
            t = time.time()
            result = job(paths)
            return {**result, "bytes": publish(paths), "took": round(time.time() - t, 1)}
        except BaseException:
            discard(paths)
            raise
        finally:
            working = None


def stats():
    covers, size = 0, 0
    for root, _, files in os.walk(OUT):
        for f in files:
            if f.endswith(NAMES):
                size += os.path.getsize(os.path.join(root, f))
                covers += f.endswith("-tall.mp4")
    return {"covers": covers, "bytes": size, "working": working}


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

    def _route(self):
        path, _, query = self.path.partition("?")
        params = dict(p.partition("=")[::2] for p in query.split("&") if p)
        return path.split("/")[1:], params

    def _receive(self, limit, suffix):
        """The body into a temporary file (a length, or chunked) -> its path, or None."""
        chunked = "chunked" in (self.headers.get("transfer-encoding") or "").lower()
        length = int(self.headers.get("content-length") or 0)
        if not chunked and (length <= 0 or length > limit):
            return None
        with tempfile.NamedTemporaryFile(dir=OUT, suffix=suffix, delete=False) as f:
            try:
                total = self._copy_chunked(f, limit) if chunked else self._copy(f, length)
            except ValueError:
                total = -1
        if total <= 0:
            os.unlink(f.name)
            return None
        return f.name

    def _copy(self, f, length):
        left = length
        while left:
            chunk = self.rfile.read(min(left, 1 << 20))
            if not chunk:
                return -1  # the sender went away
            f.write(chunk)
            left -= len(chunk)
        return length

    def _copy_chunked(self, f, limit):
        total = 0
        while True:
            size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
            if size == 0:
                while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                    pass  # trailers
                return total
            total += size
            if total > limit:
                raise ValueError("too large")
            left = size
            while left:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    raise ValueError("cut off")
                f.write(chunk)
                left -= len(chunk)
            self.rfile.readline()

    def do_PUT(self):
        parts, params = self._route()
        if len(parts) != 2 or parts[0] not in ("render", "transcode") or not KEY.match(parts[1]):
            return self._json(404, {"error": "not_found"})
        key = parts[1]
        if parts[0] == "render":
            try:
                loop = int(params.get("loop", "8"))
            except ValueError:
                loop = 0
            style = params.get("style", "auto")
            if loop not in motion.LOOPS or style not in ("auto", *motion.STYLES):
                return self._json(400, {"error": "bad_params"})
            src = self._receive(MAX_IMAGE, ".src")
            if not src:
                return self._json(400, {"error": "bad_body"})
            try:
                with open(src, "rb") as f:
                    data = f.read()

                def job(paths):
                    used, feats = motion.render(data, loop, paths, style, model(), CODEC, THREADS)
                    return {"seconds": loop, "style": used, "features": feats}

                self._json(200, make(key, job))
            except Exception as e:  # an image nothing reads, or a render failure
                print(f"render {key}: {e}", file=sys.stderr, flush=True)
                self._json(422, {"error": "render_failed"})
            finally:
                os.unlink(src)
            return
        src = self._receive(MAX_VIDEO, ".src")
        if not src:
            return self._json(400, {"error": "bad_body"})
        try:
            result = make(key, lambda paths: {
                "seconds": round(motion.transcode(src, paths, CODEC, THREADS), 2), "style": "video"})
            self._json(200, result)
        except ValueError as e:  # what is wrong with the video, said plainly
            self._json(422, {"error": "bad_video", "detail": str(e)[:200]})
        except Exception as e:
            print(f"transcode {key}: {e}", file=sys.stderr, flush=True)
            self._json(422, {"error": "bad_video", "detail": "it could not be converted"})
        finally:
            os.unlink(src)

    def do_DELETE(self):
        parts, _ = self._route()
        if len(parts) != 2 or parts[0] != "motion" or not KEY.match(parts[1]):
            return self._json(404, {"error": "not_found"})
        deleted = 0
        for name in NAMES:
            p = path_of(parts[1], name)
            if os.path.exists(p):
                os.unlink(p)
                deleted += 1
        self._json(200, {"deleted": deleted})

    def _serve(self, head):
        parts, _ = self._route()
        if len(parts) != 3 or parts[0] != "motion" or not KEY.match(parts[1]) or parts[2] not in NAMES:
            return self._json(404, {"error": "not_found"})
        p = path_of(parts[1], parts[2])
        if not os.path.exists(p):
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
        self.send_header("content-type", TYPES[parts[2].rsplit(".", 1)[1]])
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
        self._serve(True)

    def do_GET(self):
        if self.path == "/stats":
            return self._json(200, stats())
        if self.path == "/health":
            return self._json(200, {"ok": True})
        self._serve(False)


def tidy():
    """What a crash left half-done: uploads and unfinished files."""
    for root, _, files in os.walk(OUT):
        for f in files:
            if f.endswith((".src", ".part")):
                try:
                    os.unlink(os.path.join(root, f))
                except OSError:
                    pass


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    tidy()
    port = int(os.environ.get("ECHO_MOTION_PORT", "8091"))
    depth = "with" if os.path.exists(MODEL) else "WITHOUT (Living light only)"
    print(f"echo-motion on :{port}, {THREADS} threads, {CODEC}, {depth} the depth model, writing to {OUT}",
          flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
