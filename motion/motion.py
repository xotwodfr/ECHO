"""Animated lock-screen covers (docs/MOTION.md): a looping video made from an album's still cover.

Two styles, chosen per cover by classify():
  depth  photographs: the cover's estimated depth (Depth Anything V2 Small), near and far moving
         apart in a slow orbit
  light  flat or text-heavy art ("Living light"): the cover holds still while light in its own
         colours drifts over it and a soft diagonal sweep crosses it, blended as soft light so the
         cover keeps its contrast (a screen blend turns it milky)

The whole frame moves: one 1440 x 1440 render of the square cover, of which the tall video (3:4,
1080 x 1440, the lock screen's full-screen artwork) is the middle 1080 columns, the square cropped
at the sides, and the square video (1080 x 1080) the whole of it, scaled. Every motion is periodic
in the loop's phase, so the frame after the last is the first again: the loop has no seam.

Lessons from the previews on real covers (docs/superpowers/specs/2026-11-19-apple-apps-design.md):
the depth map is smoothed hard (a Gaussian of 30 px at 1440) and the orbit kept small (2.2 % of the
tall frame's width), or printed lettering bends.
"""

import json
import math
import os
import subprocess

os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(50_000_000))  # a cover, not a bomb
import cv2  # noqa: E402
import numpy as np  # noqa: E402

S = 1440  # the square render
TALL_W, TALL_H = 1080, 1440  # 3:4: the middle 1080 columns of the render, 1:1
SQUARE = 1080
X0 = (S - TALL_W) // 2  # where the tall frame starts in the render
FPS = 30
LOOPS = (5, 8, 12, 15)  # seconds; a small set keeps the cache bounded
VIDEO_MAX_SECONDS = 60  # an uploaded video longer than this is refused
STYLES = ("depth", "light")

# The rule that tells photographs from flat or text-heavy art (classify()); see docs/MOTION.md.
EVEN_FLAT = 0.65  # share of the cover in even areas from which it is flat art (photos: 0.15-0.52)
FEW_TONES = 5.0  # bits of luminance below which it is flat art (photos: 6.9-7.5)
TEXT_HEAVY = 0.07  # share on hard, high-contrast edges above which it is lettering (photos: < 0.015)
FLAT_DEPTH = 0.12  # depth spread below which there is nothing to move apart (photos: 0.24-0.36)


# ---- the cover ----------------------------------------------------------------------------------


def decode(data):
    """Image bytes (JPEG, PNG, WebP; anything else through ffmpeg) -> RGB uint8."""
    arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if arr is None:
        arr = _ffmpeg_decode(data)
    if arr is None or arr.ndim != 3 or min(arr.shape[:2]) < 16:
        raise ValueError("not an image")
    return cv2.cvtColor(arr, cv2.COLOR_BGR2RGB) if arr.shape[2] == 3 else arr


def _ffmpeg_decode(data):
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
             "-of", "json", "-i", "-"],
            input=data, capture_output=True, check=True, timeout=30,
        )
        s = json.loads(probe.stdout)["streams"][0]
        w, h = int(s["width"]), int(s["height"])
        if w * h > 50_000_000:
            return None
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", "-", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
            input=data, capture_output=True, check=True, timeout=60,
        ).stdout
        return np.frombuffer(raw, np.uint8)[: w * h * 3].reshape(h, w, 3)
    except (subprocess.SubprocessError, KeyError, IndexError, ValueError):
        return None


def square(rgb, size=S):
    """The cover as a square of [size]: the middle of a cover that is not square, scaled."""
    h, w = rgb.shape[:2]
    side = min(h, w)
    y, x = (h - side) // 2, (w - side) // 2
    rgb = rgb[y : y + side, x : x + side]
    interp = cv2.INTER_AREA if side > size else cv2.INTER_CUBIC
    return cv2.resize(rgb, (size, size), interpolation=interp)


def palette(rgb, n=6):
    """The cover's own colours (median cut), the most vivid first, as floats in 0..1."""
    px = cv2.resize(rgb, (128, 128), interpolation=cv2.INTER_AREA).reshape(-1, 3).astype(np.float32)
    boxes = [px]
    while len(boxes) < n:
        # The box whose colours stray most from its mean (squared error) is split next.
        i = max(range(len(boxes)), key=lambda k: boxes[k].var(axis=0).sum() * len(boxes[k]))
        box = boxes[i]
        if len(box) < 2 or not box.var(axis=0).any():
            break
        ch = int(np.argmax(np.ptp(box, axis=0)))
        box = box[np.argsort(box[:, ch], kind="stable")]
        mid = len(box) // 2
        boxes[i : i + 1] = [box[:mid], box[mid:]]
    pal = np.array([b.mean(0) for b in boxes], np.float32) / 255
    counts = np.array([len(b) for b in boxes], np.float32)
    mx, mn = pal.max(1), pal.min(1)
    vivid = (mx - mn) * (0.4 + mx) * np.sqrt(counts + 1)
    return pal[np.argsort(-vivid, kind="stable")]


# ---- depth --------------------------------------------------------------------------------------


class DepthModel:
    """Depth Anything V2 Small (Apache-2.0) on ONNX Runtime: relative depth, 1 = nearest."""

    SIZE = 518
    MEAN = np.array([0.485, 0.456, 0.406], np.float32)
    STD = np.array([0.229, 0.224, 0.225], np.float32)

    def __init__(self, path, threads=2):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        self.session = ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name

    def raw(self, rgb):
        x = cv2.resize(rgb, (self.SIZE, self.SIZE), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
        x = (x - self.MEAN) / self.STD
        d = self.session.run(None, {self.input: x.transpose(2, 0, 1)[None]})[0][0]
        return normalise(d)


def normalise(d):
    """Depth in 0..1 between its 1st and 99th percentiles (a few stray pixels decide nothing)."""
    lo, hi = np.percentile(d, [1, 99])
    return np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1).astype(np.float32)


def smooth_depth(d, size=S):
    """The depth map at [size], smoothed hard so edges (and lettering) never tear."""
    d = cv2.resize(d.astype(np.float32), (size, size), interpolation=cv2.INTER_CUBIC)
    return cv2.GaussianBlur(d, (0, 0), 30 * size / S)


# ---- the rule -----------------------------------------------------------------------------------


def features(rgb, depth=None):
    """What classify() decides on, from the cover at 512 px: how much of it lies in even areas (flat
    fills), its tonal range (luminance entropy, bits), the share on hard high-contrast edges
    (lettering, line art) and, given a depth map, how far its depth spreads (standard deviation)."""
    gray = cv2.cvtColor(cv2.resize(rgb, (512, 512), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY)
    p = np.bincount(gray.ravel(), minlength=256).astype(np.float64) / gray.size
    p = p[p > 0]
    tones = float(-(p * np.log2(p)).sum())
    g = gray.astype(np.float32) / 255
    mean = cv2.blur(g, (5, 5))
    var = cv2.blur(g * g, (5, 5)) - mean * mean
    even = float((var < (1.5 / 255) ** 2).mean())  # 5 x 5 neighbourhoods within 1.5 levels
    mag = np.hypot(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)) / 4
    edges = float((mag > 0.3).mean())
    out = {"even": round(even, 3), "tones": round(tones, 2), "edges": round(edges, 4)}
    if depth is not None:
        out["depth"] = round(float(np.std(depth)), 3)
    return out


def classify(f):
    """'depth' for a photograph, 'light' for flat or text-heavy art, and the reason."""
    if f["even"] >= EVEN_FLAT:
        return "light", "flat fills"
    if f["edges"] > TEXT_HEAVY:
        return "light", "text-heavy"
    if f["tones"] < FEW_TONES:
        return "light", "few tones"
    if "depth" in f and f["depth"] < FLAT_DEPTH:
        return "light", "no depth"
    return "depth", "photograph"


# ---- the two motions ----------------------------------------------------------------------------


def vignette(w, h, strength=0.5):
    """Edges a little darker, for the clock and controls over them (3 channels, as cv2 wants)."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2)
    v = (1 - strength * np.clip(r - 0.35, 0, None) ** 1.6).astype(np.float32)
    return np.repeat(v[..., None], 3, axis=2)


def _zoom(img, z, border=cv2.BORDER_REFLECT):
    """[img] magnified [z] times about its centre (z > 1 shows less of it)."""
    c = (S - 1) / 2
    m = np.array([[z, 0, c * (1 - z)], [0, z, c * (1 - z)]], np.float32)
    return cv2.warpAffine(img, m, (S, S), flags=cv2.INTER_LINEAR, borderMode=border)


class Light:
    """Living light: the prototype's light() over the whole square, in the tall frame's measures.

    The light is smooth (blobs half the frame wide, a sweep 140 px soft), so it is worked out on a
    grid of 8 px and scaled up; only the blend runs at full size. Soft light is the formula's
    darkening branch throughout: the lightening one differs by under 1.5 levels where it would
    apply (glow over 0.5, where blobs overlap).
    """

    # (palette index, radius and orbit as shares of the tall frame's width, phase)
    BLOBS = ((0, 0.55, 0.30, 0.0), (1, 0.45, 0.25, 2.1), (2, 0.50, 0.35, 4.2))
    SIGMA = 140.0  # the sweep's width, px
    GRID = 8  # px per sample of the light

    def __init__(self, rgb):
        self.base = rgb.astype(np.float32) / 255
        self.soft = self.base * (1 - self.base)  # soft light's term
        pal = palette(rgb)
        self.colours = [pal[i % len(pal)] for i, *_ in self.BLOBS]
        n = S // self.GRID
        centres = (np.arange(n, dtype=np.float32) + 0.5) * self.GRID - 0.5  # as cv2.resize lays them
        self.x = centres - X0  # tall-frame coordinates
        self.y = centres
        self.proj = self.x[None, :] * 0.8 + self.y[:, None] * 0.6  # the sweep's diagonal
        self.tint = np.array([1.0, 0.96, 0.88], np.float32) * 0.16
        self.buf = np.empty_like(self.base)

    def light(self, i, n):
        """The glow and the sweep at frame [i] of [n], on the coarse grid."""
        ph = 2 * math.pi * i / n
        glow = np.zeros((len(self.y), len(self.x), 3), np.float32)
        for (_, rad, amp, off), col in zip(self.BLOBS, self.colours):
            bx = TALL_W * (0.5 + amp * math.cos(ph + off))
            by = TALL_H * (0.5 + amp * 1.2 * math.sin(2 * ph + off))
            r2 = 2 * (rad * TALL_W) ** 2
            g = np.outer(np.exp(-((self.y - by) ** 2) / r2), np.exp(-((self.x - bx) ** 2) / r2))
            glow += g[..., None] * (0.25 + 0.75 * col)
        np.clip(glow * 0.20, 0, 1, out=glow)
        # The sweep crosses once per loop, off the frame at both ends, so the loop stays seamless.
        span = TALL_W + TALL_H
        pos = -0.4 * span + (i / n) * 1.8 * span
        band = np.exp(-((self.proj - pos) ** 2) / (2 * self.SIGMA**2)).astype(np.float32)
        return glow, band[..., None] * self.tint

    def frame(self, i, n):
        glow, sweep = self.light(i, n)
        up = lambda a: cv2.resize(a, (S, S), interpolation=cv2.INTER_LINEAR)  # noqa: E731
        # 0.55 base + 0.45 soft light, plus a little of the glow itself...
        k = up(0.45 * (2 * glow - 1))
        out = cv2.multiply(self.soft, k)
        cv2.add(out, up(0.35 * glow), dst=out)
        cv2.add(out, self.base, dst=out)
        # ...and the sweep screened over it: x + s (1 - x)
        if sweep.max() > 1 / 1024:
            s = up(sweep)
            cv2.subtract(1.0, out, dst=self.buf)
            cv2.multiply(self.buf, s, dst=self.buf)
            cv2.add(out, self.buf, dst=out)
        np.clip(out, 0, 1, out=out)
        ph = 2 * math.pi * i / n
        return _zoom(out, 1.02 + 0.02 * math.sin(ph))  # a slow breath


class Depth:
    """Depth: near and far move apart in a slow orbit (the prototype's parallax(), whole square)."""

    AMP = 0.022 * TALL_W  # the orbit, px: small, or lettering bends

    def __init__(self, rgb, depth):
        self.cover = rgb
        self.near = depth.astype(np.float32) - 0.5  # near moves one way, far the other
        self.yy, self.xx = np.mgrid[0:S, 0:S].astype(np.float32)
        self.c = (S - 1) / 2

    def frame(self, i, n):
        ph = 2 * math.pi * i / n
        # 1.04 at its least: the orbit (23.8 px at most) never reaches past the cover's edge.
        zoom = 1.065 + 0.025 * math.sin(ph)
        ox, oy = self.AMP * math.cos(ph), self.AMP * 0.6 * math.sin(ph)
        u = self.c + (self.xx - self.c) / zoom + self.near * (ox * 2)
        v = self.c + (self.yy - self.c) / zoom + self.near * (oy * 2)
        out = cv2.remap(self.cover, u, v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        return out.astype(np.float32) / 255


# ---- video --------------------------------------------------------------------------------------


def codec_args(codec, threads):
    if codec == "hevc":  # hvc1: the tag AVFoundation plays
        return ["-c:v", "libx265", "-preset", "medium", "-crf", "24", "-tag:v", "hvc1",
                "-x265-params", f"log-level=error:pools={threads}"]
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-threads", str(threads)]


def _encoder(path, w, h, codec, threads):
    return subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
         "-r", str(FPS), "-i", "-", *codec_args(codec, threads), "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", "-f", "mp4", path],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )


def still(video, dest):
    """The video's first frame as a JPEG: the lock screen shows it until the video plays."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", video, "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "2",
         "-f", "image2", "-update", "1", dest],
        check=True, capture_output=True, timeout=60,
    )


def outputs(frame, vig_tall, vig_square):
    """One render (1440 x 1440, floats 0..1) -> the tall and the square frame, vignetted, 8-bit."""
    tall = cv2.multiply(np.ascontiguousarray(frame[:, X0 : X0 + TALL_W]), vig_tall)
    sq = cv2.multiply(cv2.resize(frame, (SQUARE, SQUARE), interpolation=cv2.INTER_AREA), vig_square)
    return cv2.convertScaleAbs(tall, alpha=255), cv2.convertScaleAbs(sq, alpha=255)


def encode(motion, seconds, paths, codec="h264", threads=2):
    """Renders [seconds] of [motion] at 30 fps into paths['tall'] and paths['square'] (MP4)."""
    n = int(round(seconds * FPS))
    vt, vs = vignette(TALL_W, TALL_H), vignette(SQUARE, SQUARE)
    procs = [_encoder(paths["tall"], TALL_W, TALL_H, codec, threads),
             _encoder(paths["square"], SQUARE, SQUARE, codec, threads)]
    try:
        for i in range(n):
            for p, buf in zip(procs, outputs(motion.frame(i, n), vt, vs)):
                p.stdin.write(buf.tobytes())
        for p in procs:
            p.stdin.close()
        for p in procs:
            err = p.stderr.read()
            if p.wait() != 0:
                raise RuntimeError(f"ffmpeg: {err.decode(errors='replace')[:300]}")
    except BaseException:
        for p in procs:
            p.kill()
            p.wait()
        raise
    return n


def render(data, seconds, paths, style="auto", depth_model=None, codec="h264", threads=2):
    """A cover (image bytes) -> the motion cover: paths tall, square (MP4), tall_jpg, square_jpg.

    Returns the style used and the features it was chosen on.
    """
    if seconds not in LOOPS:
        raise ValueError("loop")
    rgb = square(decode(data))
    f = features(rgb)
    depth = None
    if style == "auto":
        style, why = classify(f)
        if style == "depth":
            if depth_model is None:
                style, why = "light", "no depth model"
            else:
                raw = depth_model.raw(rgb)
                f = features(rgb, raw)
                style, why = classify(f)
                depth = smooth_depth(raw)
        f["why"] = why
    elif style == "depth":
        if depth_model is None:
            raise ValueError("no depth model")
        depth = smooth_depth(depth_model.raw(rgb))
    motion = Depth(rgb, depth) if style == "depth" else Light(rgb)
    encode(motion, seconds, paths, codec, threads)
    still(paths["tall"], paths["tall_jpg"])
    still(paths["square"], paths["square_jpg"])
    return style, f


# ---- an uploaded video --------------------------------------------------------------------------


def probe(path):
    """An uploaded video's duration and size, or ValueError with what is wrong with it."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=format_name,duration:stream=codec_type,width,height", "-of", "json", path],
            capture_output=True, check=True, timeout=60,
        )
        info = json.loads(r.stdout)
    except (subprocess.SubprocessError, ValueError):
        raise ValueError("not a video ffmpeg can read")
    fmt = info.get("format", {})
    if "mp4" not in fmt.get("format_name", "") and "mov" not in fmt.get("format_name", ""):
        raise ValueError("not MP4 or QuickTime")
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video or int(video.get("width") or 0) < 64 or int(video.get("height") or 0) < 64:
        raise ValueError("no video in it")
    seconds = float(fmt.get("duration") or 0)
    if not 0.5 <= seconds <= VIDEO_MAX_SECONDS:
        raise ValueError(f"longer than {VIDEO_MAX_SECONDS} s" if seconds > 0.5 else "too short")
    return seconds


def transcode(src, paths, codec="h264", threads=2):
    """An uploaded video -> the same four files as render(): the frame filled (cropped, never
    letterboxed), at most 30 fps, no sound. Returns its duration."""
    seconds = probe(src)
    fill = "scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"
    graph = (f"[0:v]split=2[a][b];[a]{fill.format(w=TALL_W, h=TALL_H)}[t];"
             f"[b]{fill.format(w=SQUARE, h=SQUARE)}[s]")
    enc = [*codec_args(codec, threads), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
           "-fpsmax", str(FPS), "-f", "mp4"]
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", src, "-filter_complex", graph,
         "-map", "[t]", *enc, paths["tall"], "-map", "[s]", *enc, paths["square"]],
        capture_output=True, timeout=1800,
    )
    if r.returncode != 0:
        raise ValueError(f"ffmpeg: {r.stderr.decode(errors='replace')[:300]}")
    still(paths["tall"], paths["tall_jpg"])
    still(paths["square"], paths["square_jpg"])
    return seconds


# ---- by hand: tuning the rule on a library, previews --------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="ECHO's motion covers by hand (docs/MOTION.md).")
    cli.add_argument("command", choices=["classify", "render"])
    cli.add_argument("covers", nargs="+", help="cover images")
    cli.add_argument("--model", default=os.environ.get("ECHO_MOTION_MODEL"), help="the depth model (ONNX)")
    cli.add_argument("--out", default=".", help="render: where the four files go")
    cli.add_argument("--loop", type=int, default=8, choices=LOOPS)
    cli.add_argument("--style", default="auto", choices=("auto", *STYLES))
    cli.add_argument("--codec", default="hevc", choices=("hevc", "h264"))
    a = cli.parse_args()
    dm = DepthModel(a.model) if a.model and os.path.exists(a.model) else None
    for path in a.covers:
        with open(path, "rb") as fh:
            data = fh.read()
        if a.command == "classify":
            rgb = square(decode(data))
            f = features(rgb, dm.raw(rgb) if dm else None)
            print(json.dumps({"cover": path, **f, "style": classify(f)[0], "why": classify(f)[1]}))
            continue
        name = os.path.splitext(os.path.basename(path))[0]
        out = {k: os.path.join(a.out, f"{name}-{k.replace('_jpg', '')}.{'jpg' if 'jpg' in k else 'mp4'}")
               for k in ("tall", "square", "tall_jpg", "square_jpg")}
        style, f = render(data, a.loop, out, a.style, dm, a.codec)
        print(json.dumps({"cover": path, "style": style, **f, **out}))
