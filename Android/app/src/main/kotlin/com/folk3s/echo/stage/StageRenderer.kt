package com.folk3s.echo.stage

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.opengl.GLES30.*
import com.folk3s.echo.R
import com.folk3s.echo.api.Linear
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

// The Stage renderer (src/client/stage/renderer.ts; VISUALIZER_SPEC.md §5) on OpenGL ES 3.0, with
// the web's own shaders (assets/stage, written by scripts/android-shaders.ts): the room into a
// reduced-resolution target, Reverb's energy ping-pong, and the composite to the screen. Runs on the GLSurfaceView's thread only.

/** Filmic tone map (Hable), as palette.ts: the exposure that leaves dark colours unchanged. */
private object Hable {
  private fun h(x: Double) = (x * (0.15 * x + 0.1 * 0.5) + 0.2 * 0.02) / (x * (0.15 * x + 0.5) + 0.2 * 0.3) - 0.02 / 0.3

  val BASE_EXPOSURE = 1 / ((h(1e-4) / 1e-4) * (1 / h(11.2)))
}

class FrameInput(
  val flow: Float,
  val drift: Float,
  val cover: Float, // the cover's crossfade, 0…1
  val keyX: Float, // key light, stage uv with y down
  val keyY: Float,
  val chrome: Float,
  val seed: Float,
  val reverb: ReverbFrame?,
)

class StageRenderer(private val ctx: Context) {
  private class Program(val id: Int) {
    private val locs = HashMap<String, Int>()

    fun u(name: String) = locs.getOrPut(name) { glGetUniformLocation(id, name) }
  }

  private lateinit var roomP: Program
  private lateinit var energyP: Program
  private lateinit var compositeP: Program
  private var triangle = 0
  private var noise = 0
  private var halfFloat = false

  private var roomTex = 0
  private var roomFbo = 0
  private val energyTex = IntArray(2)
  private val energyFbo = IntArray(2)
  private var energyHead = 0
  private var covers = intArrayOf(0, 0) // previous, current

  private var w = 1
  private var h = 1
  private var dpr = 1f
  private var tier = Tier.T1
  private var built = false

  // State the frame reads (set from the GL thread by StageView).
  private var palette = StagePalette.FALLBACK
  private var brightness = 0.5f.pow(2.2f)
  private var scrimTop = 0.25f
  private var scrimDock = 0.4f
  private var reverbOn = false

  val gpu: String? get() = glGetString(GL_RENDERER)

  fun init() {
    val ext = glGetString(GL_EXTENSIONS) ?: ""
    halfFloat = "EXT_color_buffer_half_float" in ext || "EXT_color_buffer_float" in ext
    val vert = asset("fullscreen_vert")
    roomP = program(vert, asset("room_frag"))
    energyP = program(vert, asset("energy_frag"))
    compositeP = program(vert, asset("composite_frag"))
    triangle = buffer(floatArrayOf(-1f, -1f, 0f, 3f, -1f, 0f, -1f, 3f, 0f), GL_STATIC_DRAW)
    noise = noiseTexture()
    covers = intArrayOf(0, 0)
    built = false
  }

  private fun asset(name: String) = ctx.assets.open("stage/$name.glsl").bufferedReader().readText()

  private fun shader(type: Int, src: String): Int {
    val s = glCreateShader(type)
    glShaderSource(s, "#version 300 es\n$src")
    glCompileShader(s)
    val ok = IntArray(1)
    glGetShaderiv(s, GL_COMPILE_STATUS, ok, 0)
    check(ok[0] != 0) { "Stage shader: ${glGetShaderInfoLog(s)}" }
    return s
  }

  private fun program(vert: String, frag: String): Program {
    val p = glCreateProgram()
    glAttachShader(p, shader(GL_VERTEX_SHADER, vert))
    glAttachShader(p, shader(GL_FRAGMENT_SHADER, frag))
    glBindAttribLocation(p, 0, "position")
    glLinkProgram(p)
    val ok = IntArray(1)
    glGetProgramiv(p, GL_LINK_STATUS, ok, 0)
    check(ok[0] != 0) { "Stage program: ${glGetProgramInfoLog(p)}" }
    return Program(p)
  }

  private fun floats(a: FloatArray): FloatBuffer =
    ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().put(a).also { it.position(0) }

  private fun buffer(data: FloatArray, usage: Int): Int {
    val b = IntArray(1)
    glGenBuffers(1, b, 0)
    glBindBuffer(GL_ARRAY_BUFFER, b[0])
    glBufferData(GL_ARRAY_BUFFER, data.size * 4, floats(data), usage)
    return b[0]
  }

  private fun texture(): Int {
    val t = IntArray(1)
    glGenTextures(1, t, 0)
    glBindTexture(GL_TEXTURE_2D, t[0])
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
    return t[0]
  }

  private fun noiseTexture(): Int {
    val bmp = BitmapFactory.decodeResource(ctx.resources, R.drawable.blue_noise_64, BitmapFactory.Options().apply { inScaled = false })
    val t = texture()
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST)
    upload(bmp, GL_RGBA8)
    bmp.recycle()
    return t
  }

  private fun upload(bmp: Bitmap, internal: Int) {
    val px = ByteBuffer.allocateDirect(bmp.width * bmp.height * 4).order(ByteOrder.nativeOrder())
    bmp.copy(Bitmap.Config.ARGB_8888, false).also { it.copyPixelsToBuffer(px) }
    px.position(0)
    glTexImage2D(GL_TEXTURE_2D, 0, internal, bmp.width, bmp.height, 0, GL_RGBA, GL_UNSIGNED_BYTE, px)
  }

  private fun target(tw: Int, th: Int): Pair<Int, Int> {
    val t = texture()
    if (halfFloat) glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA16F, tw, th, 0, GL_RGBA, GL_HALF_FLOAT, null)
    else glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, tw, th, 0, GL_RGBA, GL_UNSIGNED_BYTE, null)
    val f = IntArray(1)
    glGenFramebuffers(1, f, 0)
    glBindFramebuffer(GL_FRAMEBUFFER, f[0])
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, t, 0)
    glClearColor(0f, 0f, 0f, 1f)
    glClear(GL_COLOR_BUFFER_BIT)
    glBindFramebuffer(GL_FRAMEBUFFER, 0)
    return t to f[0]
  }

  private fun buildTargets() {
    glDeleteTextures(3, intArrayOf(roomTex, energyTex[0], energyTex[1]), 0)
    glDeleteFramebuffers(3, intArrayOf(roomFbo, energyFbo[0], energyFbo[1]), 0)
    val tw = max(1, (w * tier.roomScale).roundToInt())
    val th = max(1, (h * tier.roomScale).roundToInt())
    target(tw, th).let { (t, f) -> roomTex = t; roomFbo = f }
    for (i in 0..1) target(tw, th).let { (t, f) -> energyTex[i] = t; energyFbo[i] = f }
    built = true
  }

  /** The surface in backing pixels, and backing pixels per dp (the web's CSS px). */
  fun setSize(width: Int, height: Int, pxPerDp: Float) {
    w = max(1, width)
    h = max(1, height)
    dpr = pxPerDp
    buildTargets()
  }

  fun setTier(t: Tier) {
    tier = t
    if (built) buildTargets()
  }

  fun setPalette(p: StagePalette) {
    palette = p
  }

  /** The cover's brightness, 0…1 as the slider shows it; perceptual, so squared-ish into light. */
  fun setBrightness(b: Float) {
    brightness = max(0f, b).pow(2.2f)
  }

  fun setScrims(top: Float, dock: Float) {
    scrimTop = top
    scrimDock = dock
  }

  /** The track's cover as the room's base (blurred, [coverBitmap]), or null; crossfades from the last. */
  fun setCover(bmp: Bitmap?) {
    if (covers[0] != 0) glDeleteTextures(1, intArrayOf(covers[0]), 0)
    val next =
      bmp?.let {
        val t = texture()
        upload(it, GL_SRGB8_ALPHA8) // sampled as linear light, like the room
        t
      } ?: 0
    covers = intArrayOf(covers[1], next)
  }

  fun setReverb(on: Boolean) {
    if (on == reverbOn) return
    reverbOn = on
    if (!on && built) for (f in energyFbo) {
      glBindFramebuffer(GL_FRAMEBUFFER, f)
      glClear(GL_COLOR_BUFFER_BIT)
    }
    glBindFramebuffer(GL_FRAMEBUFFER, 0)
  }

  private fun bind(unit: Int, tex: Int) {
    glActiveTexture(GL_TEXTURE0 + unit)
    glBindTexture(GL_TEXTURE_2D, tex)
  }

  private fun drawTriangle() {
    glBindBuffer(GL_ARRAY_BUFFER, triangle)
    glEnableVertexAttribArray(0)
    glVertexAttribPointer(0, 3, GL_FLOAT, false, 0, 0)
    glDrawArrays(GL_TRIANGLES, 0, 3)
  }

  private fun Program.v3(name: String, c: Linear) = glUniform3f(u(name), c.r, c.g, c.b)

  fun render(f: FrameInput) {
    if (!built) return
    val rv = f.reverb
    val p = palette
    val aspect = w.toFloat() / h
    val roomW = max(1, (w * tier.roomScale).roundToInt())
    val roomH = max(1, (h * tier.roomScale).roundToInt())

    // Pass 1, the room.
    glBindFramebuffer(GL_FRAMEBUFFER, roomFbo)
    glViewport(0, 0, roomW, roomH)
    glUseProgram(roomP.id)
    with(roomP) {
      glUniform1f(u("uAspect"), aspect)
      glUniform1f(u("uFlow"), rv?.flow?.toFloat() ?: f.flow)
      glUniform1f(u("uDrift"), f.drift)
      glUniform1f(u("uSeed"), f.seed)
      bind(3, covers[1])
      glUniform1i(u("uCover"), 3)
      bind(4, covers[0])
      glUniform1i(u("uCoverPrev"), 4)
      glUniform2f(u("uCoverOn"), if (covers[0] != 0) 1f else 0f, if (covers[1] != 0) 1f else 0f)
      glUniform1f(u("uCoverFade"), f.cover)
      glUniform1f(u("uBrightness"), brightness)
      v3("uRoom", p.room)
      v3("uAccent", p.accent)
      v3("uHighlight", p.highlight)
      glUniform3f(u("uGlow"), p.glow.r * p.glow.a, p.glow.g * p.glow.a, p.glow.b * p.glow.a)
      glUniform2f(u("uKey"), f.keyX, f.keyY)
      glUniform1f(u("uPoolScale"), rv?.poolScale?.toFloat() ?: 1f)
      glUniform1f(u("uKeyScale"), rv?.keyScale?.toFloat() ?: 1f)
    }
    drawTriangle()

    // Pass 2, energy (Reverb only): the previous buffer decays, rings and the flare are added.
    if (rv != null) {
      val prev = energyHead
      val next = 1 - energyHead
      glBindFramebuffer(GL_FRAMEBUFFER, energyFbo[next])
      glUseProgram(energyP.id)
      with(energyP) {
        bind(5, energyTex[prev])
        glUniform1i(u("uPrev"), 5)
        glUniform1f(u("uAspect"), aspect)
        glUniform1f(u("uDecay"), rv.decay.toFloat())
        glUniform1f(u("uWarp"), rv.warp.toFloat())
        glUniform1f(u("uFlow"), rv.flow.toFloat())
        glUniform2f(u("uKey"), f.keyX, f.keyY)
        val rings = FloatArray(12)
        rv.rings.take(3).forEachIndexed { i, r ->
          rings[i * 4] = r.x.toFloat()
          rings[i * 4 + 1] = r.y.toFloat()
          rings[i * 4 + 2] = r.radius().toFloat()
          rings[i * 4 + 3] = r.light().toFloat()
        }
        glUniform4fv(u("uRings[0]"), 3, rings, 0)
        val tint = safeTint(p.highlight.r, p.highlight.g, p.highlight.b)
        glUniform3f(u("uTint"), tint[0], tint[1], tint[2])
        glUniform1f(u("uFlare"), rv.flare.toFloat())
      }
      drawTriangle()
      energyHead = next
    }

    // Pass 4, the composite.
    glBindFramebuffer(GL_FRAMEBUFFER, 0)
    glViewport(0, 0, w, h)
    composite(compositeP, f, rv)
    drawTriangle()
  }

  private fun composite(prog: Program, f: FrameInput, rv: ReverbFrame?) {
    val p = palette
    glUseProgram(prog.id)
    with(prog) {
      bind(0, roomTex)
      glUniform1i(u("uRoomTex"), 0)
      bind(1, noise)
      glUniform1i(u("uNoise"), 1)
      bind(2, energyTex[energyHead])
      glUniform1i(u("uEnergyTex"), 2)
      glUniform1f(u("uEnergyOn"), if (rv != null) 1f else 0f)
      glUniform2f(u("uRes"), w.toFloat(), h.toFloat())
      glUniform1f(u("uDpr"), dpr)
      v3("uShadow", p.shadow)
      glUniform1f(u("uChrome"), f.chrome)
      glUniform1f(u("uScrimTop"), scrimTop)
      glUniform1f(u("uScrimDock"), scrimDock)
      glUniform1f(u("uExposure"), (Hable.BASE_EXPOSURE * (rv?.exposure ?: 1.0)).toFloat())
      glUniform1f(u("uZoneExposure"), 0f)
      glUniform1f(u("uZoneScrim"), 0f)
      glUniform2f(u("uKeyUv"), f.keyX, 1 - f.keyY)
    }
  }
}
