package com.folk3s.echo.stage

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.opengl.GLSurfaceView
import android.os.SystemClock
import com.folk3s.echo.api.Linear
import com.folk3s.echo.api.linearToOklab
import com.folk3s.echo.api.oklabToLinear
import com.folk3s.echo.echo
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import okhttp3.Request

// The Stage's frame loop (src/client/stage/loop.ts and engine.ts on Android): one GL thread that
// moves time (ambient flow and drift, slowed to 25% while paused), eases the chrome, crossfades
// the cover and the palette, steps Reverb and the governor, and draws. Still mode draws on demand.

private const val AMBIENT_FLOW_PER_S = 0.05
private const val PAUSED_RATE = 0.25
private const val RATE_RAMP_S = 1.5
private const val MAX_DT_MS = 100.0
private const val CHROME_IN_MS = 160.0
private const val CHROME_OUT_MS = 640.0
private const val PALETTE_MS = 1200.0

enum class RoomMode { Ambient, Reverb, Still }

@SuppressLint("ViewConstructor")
class StageView(context: Context, initialTier: Tier, private val manualTier: Boolean) : GLSurfaceView(context), GLSurfaceView.Renderer {
  private val renderer = StageRenderer(context)
  private val analyser = AnalyserFeatures()
  private var reverb = Reverb()
  private var tier = initialTier
  private val governor = Governor(initialTier, manualTier) { SystemClock.elapsedRealtime().toDouble() }

  // Read by the GL thread, written from the UI thread.
  @Volatile var playing = false
  @Volatile var chromeVisible = true
  @Volatile private var room = RoomMode.Ambient
  @Volatile var keyX = 0.5f
  @Volatile var keyY = 0.4f
  @Volatile var trackStartedAt = 0L

  /** The newest audio features (§3.4), for the lyric field's beat terms. */
  @Volatile var features = Features.SILENT
    private set

  /** Called on the GL thread when the governor changes the tier (the screen remembers it). */
  var onTier: (Tier) -> Unit = {}

  // GL thread only.
  private var last = 0L
  private var flow = 0.0
  private var drift = 0.0
  private var rate = PAUSED_RATE
  private var chrome = 1.0
  private var coverAt = 0L
  private var coverBmp: Bitmap? = null
  private var palFrom = StagePalette.FALLBACK
  private var palTo = StagePalette.FALLBACK
  private var palAt = 0L
  private var ready = false
  private var still = false

  init {
    setEGLContextClientVersion(3)
    setEGLConfigChooser(8, 8, 8, 8, 0, 0)
    preserveEGLContextOnPause = true
    setRenderer(this)
    renderMode = RENDERMODE_CONTINUOUSLY
  }

  // ---- inputs ----

  fun setMode(m: RoomMode) {
    room = m
    val wantStill = m == RoomMode.Still || tier == Tier.T3
    if (wantStill != still) {
      still = wantStill
      renderMode = if (still) RENDERMODE_WHEN_DIRTY else RENDERMODE_CONTINUOUSLY
    }
    requestRender()
  }

  fun setIntensity(i: Intensity) = queueEvent { reverb = Reverb(i) }

  fun setBrightness(b: Float) = queueEvent {
    renderer.setBrightness(b)
    requestRender()
  }

  fun setPalette(p: StagePalette) = queueEvent {
    palFrom = currentPalette(SystemClock.elapsedRealtime())
    palTo = p
    palAt = SystemClock.elapsedRealtime()
    requestRender()
  }

  fun setChrome(visible: Boolean) {
    chromeVisible = visible
    requestRender()
  }

  fun setGlass(boxes: List<GlassBox>) {
    val dp = resources.displayMetrics.density
    val (rects, corners, n) = glassUniforms(width / dp, height / dp, boxes)
    queueEvent {
      renderer.setGlass(rects, corners, n)
      requestRender()
    }
  }

  /** The track's cover, fetched and blurred off the GL thread, then crossfaded in. */
  fun showCover(url: String?) {
    val app = context.echo
    Thread {
      val bmp =
        url?.let {
          runCatching {
              app.api.http.newCall(Request.Builder().url(app.api.url(it)).build()).execute().use { r ->
                if (r.isSuccessful) BitmapFactory.decodeStream(r.body.byteStream())?.let(::coverBitmap) else null
              }
            }
            .getOrNull()
        }
      queueEvent {
        coverBmp = bmp
        renderer.setCover(bmp)
        coverAt = SystemClock.elapsedRealtime()
        requestRender()
      }
    }.start()
  }

  // ---- the tier's backing store (§5.5): the surface at min(density, cap) px per dp ----

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    applyTierSize()
  }

  private fun applyTierSize() {
    if (width == 0 || height == 0) return
    val d = resources.displayMetrics.density
    val k = min(d, tier.dprCap) / d
    holder.setFixedSize(max(1, (width * k).roundToInt()), max(1, (height * k).roundToInt()))
  }

  // ---- GL ----

  override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
    renderer.init()
    renderer.setTier(tier)
    // The glass the --glass-* tokens describe (§7.11), the same physics as the web's.
    val g = GlassParams()
    renderer.setGlassLook(bendProfile(g), g.bezel.toFloat(), g.saturate.toFloat(), g.specular.toFloat(), g.light.toFloat())
    // A new context has no textures: the cover comes back at once, without a crossfade.
    renderer.setCover(coverBmp)
    renderer.setCover(coverBmp)
    ready = true
    if (!manualTier && tier == Tier.T1) firstTier(renderer.gpu).takeIf { it != tier }?.let { changeTier(it) }
  }

  override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
    val dp = width / resources.displayMetrics.density
    renderer.setSize(w, h, if (dp > 0) w / dp else 1f)
  }

  private fun changeTier(t: Tier) {
    tier = t
    renderer.setTier(t)
    onTier(t)
    post {
      applyTierSize()
      setMode(room)
    }
  }

  private fun currentPalette(now: Long): StagePalette {
    val k = ((now - palAt) / PALETTE_MS).coerceIn(0.0, 1.0)
    return if (k >= 1) palTo else lerp(palFrom, palTo, k)
  }

  override fun onDrawFrame(gl: GL10?) {
    if (!ready) return
    val now = SystemClock.elapsedRealtime()
    val dt = if (still || last == 0L) 0.0 else (now - last).toDouble().coerceIn(0.0, MAX_DT_MS)
    last = now

    // Ambient time: eases towards full speed while playing, 25% while paused.
    val target = if (playing) 1.0 else PAUSED_RATE
    val ramp = (1 - PAUSED_RATE) / RATE_RAMP_S * (dt / 1000)
    rate = if (rate < target) min(target, rate + ramp) else max(target, rate - ramp)
    if (!still) {
      flow += AMBIENT_FLOW_PER_S * rate * (dt / 1000)
      drift += rate * (dt / 1000)
    }

    // Scrims and glass follow the chrome: back in 160 ms, out over 640 ms; Still snaps.
    val ct = if (chromeVisible) 1.0 else 0.0
    chrome = if (still) ct else if (chrome < ct) min(ct, chrome + dt / CHROME_IN_MS) else max(ct, chrome - dt / CHROME_OUT_MS)

    val reverbOn = room == RoomMode.Reverb && !still
    val features = if (reverbOn) analyser.sample(dt) else Features.SILENT
    this.features = features
    renderer.setReverb(reverbOn)
    val rv = if (reverbOn) reverb.step(features, dt, keyX.toDouble(), keyY.toDouble()) else null

    if (!still) governor.sample(dt, (now - trackStartedAt).toDouble(), false)?.let(::changeTier)

    renderer.setPalette(currentPalette(now))
    val cover = if (still) 1f else min(1f, (now - coverAt) / PALETTE_MS.toFloat())
    renderer.render(FrameInput(flow.toFloat(), drift.toFloat(), cover, keyX, keyY, chrome.toFloat(), 0f, rv))
    // Palette and chrome transitions still need frames in Still mode.
    if (still && (now - palAt < PALETTE_MS)) requestRender()
  }
}

/** Two palettes mixed in OKLab (the web's palette animator), `k` from a to b. */
private fun lerp(a: StagePalette, b: StagePalette, k: Double): StagePalette {
  fun mix(x: Linear, y: Linear): Linear {
    val p = linearToOklab(x.r.toDouble(), x.g.toDouble(), x.b.toDouble())
    val q = linearToOklab(y.r.toDouble(), y.g.toDouble(), y.b.toDouble())
    val r = oklabToLinear(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k)
    return Linear(r[0].toFloat().coerceIn(0f, 1f), r[1].toFloat().coerceIn(0f, 1f), r[2].toFloat().coerceIn(0f, 1f), (x.a + (y.a - x.a) * k).toFloat())
  }
  return StagePalette(mix(a.room, b.room), mix(a.accent, b.accent), mix(a.highlight, b.highlight), mix(a.glow, b.glow), mix(a.shadow, b.shadow), mix(a.ink, b.ink))
}

/**
 * The room's base cover (renderer.ts coverTexture): 96 px, blurred once (5 px) and saturated 1.4,
 * drawn with an overscan first so the blur never pulls in an edge. Stretched over the stage by
 * linear filtering it stays smooth and costs one texture fetch.
 */
fun coverBitmap(src: Bitmap): Bitmap {
  val size = 96
  val blur = 5
  val over = size + 4 * blur
  val big = Bitmap.createBitmap(over, over, Bitmap.Config.ARGB_8888)
  val side = min(src.width, src.height)
  val paint = Paint(Paint.FILTER_BITMAP_FLAG).apply {
    colorFilter =
      ColorMatrixColorFilter(
        ColorMatrix().apply { setSaturation(1.4f) },
      )
  }
  Canvas(big).drawBitmap(src, Rect((src.width - side) / 2, (src.height - side) / 2, (src.width + side) / 2, (src.height + side) / 2), Rect(0, 0, over, over), paint)
  val px = IntArray(over * over)
  big.getPixels(px, 0, over, 0, 0, over, over)
  gaussian(px, over, blur.toDouble())
  big.setPixels(px, 0, over, 0, 0, over, over)
  return Bitmap.createBitmap(big, 2 * blur, 2 * blur, size, size)
}

/** A separable Gaussian blur (σ = `sigma` px) over ARGB pixels, edges clamped. */
private fun gaussian(px: IntArray, n: Int, sigma: Double) {
  val r = (sigma * 3).toInt()
  val k = DoubleArray(2 * r + 1) { i -> exp(-((i - r) * (i - r)) / (2 * sigma * sigma)) }
  val sum = k.sum()
  for (i in k.indices) k[i] /= sum
  val tmp = IntArray(px.size)
  fun pass(from: IntArray, to: IntArray, horizontal: Boolean) {
    for (y in 0 until n) for (x in 0 until n) {
      var a = 0.0
      var rr = 0.0
      var g = 0.0
      var b = 0.0
      for (i in -r..r) {
        val sx = if (horizontal) (x + i).coerceIn(0, n - 1) else x
        val sy = if (horizontal) y else (y + i).coerceIn(0, n - 1)
        val c = from[sy * n + sx]
        val w = k[i + r]
        a += (c ushr 24) * w
        rr += (c shr 16 and 0xFF) * w
        g += (c shr 8 and 0xFF) * w
        b += (c and 0xFF) * w
      }
      to[y * n + x] = (a.roundToInt() shl 24) or (rr.roundToInt() shl 16) or (g.roundToInt() shl 8) or b.roundToInt()
    }
  }
  pass(px, tmp, true)
  pass(tmp, px, false)
}
