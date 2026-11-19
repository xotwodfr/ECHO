"""The motion service's tests (motion/README.md): the photo-or-flat rule on synthetic covers, loops
that have no seam, uploaded videos, and the HTTP service. Run: python -m pytest motion

ECHO_MOTION_MODEL (a Depth Anything V2 Small ONNX file) adds a test with the real model.
"""

import http.client
import importlib
import json
import os
import subprocess
import sys
import threading

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(__file__))
import motion  # noqa: E402

RNG = np.random.default_rng(7)


def jpeg(rgb, quality=88):
    """As a real cover arrives: a JPEG."""
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return motion.decode(buf.tobytes())


def flat_poster():
    """Flat art: a few solid shapes in four colours."""
    a = np.full((900, 900, 3), (20, 30, 60), np.uint8)
    cv2.circle(a, (450, 380), 230, (240, 180, 40), -1, cv2.LINE_AA)
    cv2.rectangle(a, (0, 640), (900, 900), (200, 40, 90), -1)
    cv2.fillPoly(a, [np.array([[90, 820], [450, 450], [810, 820]])], (60, 170, 160), cv2.LINE_AA)
    return jpeg(a)


def typographic():
    """A title in big letters on a plain ground."""
    a = np.full((900, 900, 3), (230, 60, 40), np.uint8)
    for k, t in enumerate(["NIGHT", "DRIVE", "2026"]):
        cv2.putText(a, t, (50, 280 + k * 240), cv2.FONT_HERSHEY_DUPLEX, 6.2, (250, 240, 220), 24, cv2.LINE_AA)
    return jpeg(a)


def gradient_with_title():
    """A smooth gradient (many tones, but every area even) and a line of type."""
    y = np.linspace(0, 1, 900)[:, None]
    a = np.stack([60 + 150 * y, 40 + 60 * y, 120 - 80 * y], -1).repeat(900, 1).astype(np.uint8)
    cv2.putText(a, "the long way home", (80, 800), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (255, 255, 255), 5, cv2.LINE_AA)
    return jpeg(a)


def text_page(grain=0.0):
    """Lines and lines of lettering (on paper with [grain], so its areas are not even)."""
    a = np.full((900, 900, 3), 240, np.float32)
    a += RNG.normal(0, grain, a.shape)
    a = np.clip(a, 0, 255).astype(np.uint8)
    for k in range(13):
        cv2.putText(a, "lorem ipsum dolor sit", (30, 64 + k * 66), cv2.FONT_HERSHEY_SIMPLEX, 1.7, (15, 15, 15), 4,
                    cv2.LINE_AA)
    return jpeg(a)


def photo(mono=False):
    """A stand-in photograph: soft light, a lit subject, film grain and fine texture."""
    yy, xx = np.mgrid[0:900, 0:900] / 900
    base = np.stack([0.5 + 0.35 * np.sin(3 * xx + 1), 0.4 + 0.3 * np.cos(2 * yy), 0.3 + 0.2 * xx * yy], -1)
    subject = np.exp(-(((xx - 0.5) ** 2 + (yy - 0.45) ** 2) / 0.03))[..., None] * np.array([0.5, 0.3, 0.2])
    texture = cv2.GaussianBlur(RNG.normal(0, 1, (900, 900, 3)).astype(np.float32), (0, 0), 1.5) * 0.06
    f = np.clip(base + subject + texture + RNG.normal(0, 0.015, (900, 900, 3)), 0, 1)
    if mono:
        f = np.repeat(f.mean(2, keepdims=True), 3, axis=2)
    return jpeg((f * 255).astype(np.uint8))


def depth_of_subject():
    """A depth map with a near subject and a far ground (what the model gives a portrait)."""
    yy, xx = np.mgrid[0:518, 0:518] / 518
    return motion.normalise(0.2 + 0.8 * np.exp(-(((xx - 0.5) ** 2 + (yy - 0.5) ** 2) / 0.05)))


def depth_flat():
    """A depth map with nothing near or far: a little noise on a plane."""
    return motion.normalise(np.full((518, 518), 0.5) + RNG.normal(0, 0.01, (518, 518))) * 0.1


# ---- the rule -----------------------------------------------------------------------------------


@pytest.mark.parametrize("cover", [flat_poster, typographic, gradient_with_title, text_page])
def test_flat_art_gets_living_light(cover):
    rgb = motion.square(cover())
    assert motion.classify(motion.features(rgb, depth_of_subject())) == ("light", "flat fills")


def test_lettering_on_textured_paper_is_text_heavy():
    f = motion.features(motion.square(text_page(grain=10)), depth_of_subject())
    assert f["even"] < motion.EVEN_FLAT  # the grain leaves no even areas...
    assert motion.classify(f) == ("light", "text-heavy")  # ...but the type gives it away


def test_photographs_get_depth_in_colour_and_black_and_white():
    for mono in (False, True):
        f = motion.features(motion.square(photo(mono)), depth_of_subject())
        assert f["even"] < motion.EVEN_FLAT and f["tones"] > motion.FEW_TONES
        assert motion.classify(f) == ("depth", "photograph")


def test_a_photograph_with_nothing_to_move_apart_gets_light():
    f = motion.features(motion.square(photo()), depth_flat())
    assert motion.classify(f) == ("light", "no depth")


def test_few_tones_alone_is_flat():
    assert motion.classify({"even": 0.3, "tones": 3.0, "edges": 0.0}) == ("light", "few tones")


def test_palette_is_the_covers_own_colours_most_vivid_first():
    pal = motion.palette(flat_poster())
    assert pal.shape[1] == 3 and len(pal) == 6
    # The yellow disc (240, 180, 40) is the most vivid colour on the poster.
    assert np.allclose(pal[0], np.array([240, 180, 40]) / 255, atol=0.08)


# ---- seamless loops -----------------------------------------------------------------------------


def frames_loop(m, n):
    first, last, after = m.frame(0, n), m.frame(n - 1, n), m.frame(n, n)
    steps = [np.abs(m.frame(i + 1, n) - m.frame(i, n)).mean() for i in (0, n // 3, 2 * n // 3)]
    return first, last, after, steps


@pytest.mark.parametrize("style", ["light", "depth"])
def test_the_frame_after_the_last_is_the_first(style):
    rgb = motion.square(photo(), 1440)
    m = motion.Light(rgb) if style == "light" else motion.Depth(rgb, motion.smooth_depth(depth_of_subject()))
    n = 24  # a short loop moves most per frame: the hardest case
    first, last, after, steps = frames_loop(m, n)
    assert np.abs(after - first).max() < 1 / 255  # periodic in the loop's phase
    # Wrapping round is a step like any other: no jump where the loop starts again.
    assert np.abs(first - last).mean() <= 1.5 * max(steps) + 1e-6
    assert max(steps) > 1e-4  # and it does move


class FakeDepth:
    """The model's place in tests without the model: a portrait's depth."""

    def raw(self, rgb):
        return depth_of_subject()


def decoded(path, index, count):
    """Frame [index] of [count] of a video as floats (by decoding all, as ffmpeg seeks to keyframes)."""
    w, h = probe_size(path)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)
    assert len(frames) == count
    return frames[index].astype(np.float32) / 255


def probe_size(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,codec_name", "-of", "json", path], capture_output=True, check=True)
    s = json.loads(r.stdout)["streams"][0]
    return int(s["width"]), int(s["height"])


def paths_in(d):
    return {"tall": f"{d}/t.mp4", "square": f"{d}/s.mp4", "tall_jpg": f"{d}/t.jpg", "square_jpg": f"{d}/s.jpg"}


@pytest.mark.parametrize("style, cover", [("light", typographic), ("depth", photo)])
def test_a_rendered_loop_has_no_seam_and_the_right_shapes(tmp_path, style, cover):
    paths = paths_in(tmp_path)
    ok, buf = cv2.imencode(".png", cv2.cvtColor(cover(), cv2.COLOR_RGB2BGR))
    used, f = motion.render(buf.tobytes(), 5, paths, "auto", FakeDepth(), codec="h264", threads=2)
    assert used == style
    n = 5 * motion.FPS
    assert probe_size(paths["tall"]) == (1080, 1440)
    assert probe_size(paths["square"]) == (1080, 1080)
    for name in ("tall", "square"):
        first, second, last = (decoded(paths[name], i, n) for i in (0, 1, n - 1))
        step = np.abs(second - first).mean()
        assert np.abs(last - first).mean() <= 2 * step + 0.002  # the last frame leads into the first
        jpg = cv2.cvtColor(cv2.imread(paths[f"{name}_jpg"]), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        assert jpg.shape == first.shape
        assert np.abs(jpg - first).mean() < 0.02  # the still is the first frame


def test_hevc_is_tagged_for_apple(tmp_path):
    paths = paths_in(tmp_path)
    ok, buf = cv2.imencode(".png", cv2.cvtColor(flat_poster(), cv2.COLOR_RGB2BGR))
    motion.render(buf.tobytes(), 5, paths, "light", None, codec="hevc", threads=2)
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,codec_tag_string,pix_fmt",
                        "-of", "json", paths["tall"]], capture_output=True, check=True)
    s = json.loads(r.stdout)["streams"][0]
    assert (s["codec_name"], s["codec_tag_string"], s["pix_fmt"]) == ("hevc", "hvc1", "yuv420p")


def test_a_loop_length_outside_the_set_is_refused(tmp_path):
    ok, buf = cv2.imencode(".png", flat_poster())
    with pytest.raises(ValueError):
        motion.render(buf.tobytes(), 7, paths_in(tmp_path))


def test_a_non_square_cover_is_cropped_to_its_middle():
    wide = np.zeros((400, 800, 3), np.uint8)
    wide[:, 200:600] = 255  # the middle square is white
    assert motion.square(wide, 100).min() == 255


@pytest.mark.skipif(not os.path.exists(os.environ.get("ECHO_MOTION_MODEL", "/nonexistent")), reason="no model")
def test_the_real_depth_model_finds_depth_to_move_apart_in_a_photograph():
    m = motion.DepthModel(os.environ["ECHO_MOTION_MODEL"])
    d = m.raw(motion.square(photo(), 1440))
    assert d.shape == (518, 518) and 0 <= d.min() and d.max() <= 1
    assert np.std(d) > motion.FLAT_DEPTH


# ---- uploaded videos ----------------------------------------------------------------------------


def make_video(path, seconds, size="640x360", audio=False):
    args = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=30:duration={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=duration={seconds}"]
    subprocess.run([*args, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path], check=True)


def test_an_uploaded_video_fills_both_frames_without_sound(tmp_path):
    src = str(tmp_path / "in.mov")
    make_video(src, 2, audio=True)
    paths = paths_in(tmp_path)
    assert motion.transcode(src, paths, codec="h264") == pytest.approx(2, abs=0.1)
    assert probe_size(paths["tall"]) == (1080, 1440)
    assert probe_size(paths["square"]) == (1080, 1080)
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", paths["tall"]],
                       capture_output=True, check=True)
    assert [s["codec_type"] for s in json.loads(r.stdout)["streams"]] == ["video"]
    assert cv2.imread(paths["square_jpg"]).shape == (1080, 1080, 3)


def test_what_is_not_a_short_video_is_refused_plainly(tmp_path):
    junk = tmp_path / "junk.mp4"
    junk.write_bytes(b"\x00\x00\x00\x18ftypisom" + os.urandom(2000))
    with pytest.raises(ValueError, match="not a video"):
        motion.probe(str(junk))
    long = str(tmp_path / "long.mp4")
    make_video(long, 61, size="64x64")
    with pytest.raises(ValueError, match="longer than 60 s"):
        motion.probe(long)


# ---- the service --------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def service(tmp_path_factory):
    out = tmp_path_factory.mktemp("motion")
    os.environ.update(ECHO_MOTION_DIR=str(out), ECHO_MOTION_MODEL=str(out / "none.onnx"), ECHO_MOTION_CODEC="h264")
    server = importlib.import_module("server")
    httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield httpd.server_address[1], out
    httpd.shutdown()


def request(port, method, path, body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=120)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, dict(r.getheaders()), data


def test_the_service_transcodes_serves_with_range_and_deletes(service, tmp_path):
    port, out = service
    src = tmp_path / "in.mp4"
    make_video(str(src), 1)
    status, _, body = request(port, "PUT", "/transcode/k1", src.read_bytes())
    assert status == 200
    result = json.loads(body)
    assert result["style"] == "video" and result["bytes"] > 0
    status, headers, part = request(port, "GET", "/motion/k1/tall.mp4", headers={"range": "bytes=4-11"})
    assert status == 206 and part == b"ftypisom"
    assert headers["content-type"] == "video/mp4" and headers["content-range"].startswith("bytes 4-11/")
    status, headers, _ = request(port, "HEAD", "/motion/k1/square.jpg")
    assert status == 200 and headers["content-type"] == "image/jpeg"
    assert json.loads(request(port, "GET", "/stats")[2])["covers"] == 1
    assert json.loads(request(port, "DELETE", "/motion/k1")[2]) == {"deleted": 4}
    assert request(port, "HEAD", "/motion/k1/tall.mp4")[0] == 404
    assert not [f for _, _, fs in os.walk(out) for f in fs]  # nothing half-written left behind


def test_the_service_refuses_what_it_cannot_use(service):
    port, _ = service
    assert request(port, "PUT", "/render/k2?loop=7", b"x")[0] == 400  # not a loop length it makes
    assert request(port, "PUT", "/render/k2?loop=8&style=drift", b"x")[0] == 400
    assert request(port, "PUT", "/render/../x?loop=8", b"x")[0] == 404
    assert request(port, "PUT", "/render/k2?loop=8", b"not an image at all")[0] == 422
    status, _, body = request(port, "PUT", "/transcode/k3", b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64)
    assert status == 422 and json.loads(body)["error"] == "bad_video"
    assert request(port, "GET", "/motion/k3/tall.mp4")[0] == 404
    assert request(port, "GET", "/motion/k3/../../etc/passwd")[0] == 404
