package com.folk3s.echo

import com.folk3s.echo.api.Attribution
import com.folk3s.echo.api.LyricLine
import com.folk3s.echo.api.LyricWord
import com.folk3s.echo.api.LyricsDoc
import com.folk3s.echo.api.parseCss
import com.folk3s.echo.api.toArgb
import com.folk3s.echo.stage.Features
import com.folk3s.echo.stage.GlassBox
import com.folk3s.echo.stage.GlassParams
import com.folk3s.echo.stage.LUMA_SLEW_PER_S
import com.folk3s.echo.stage.Reverb
import com.folk3s.echo.stage.bend
import com.folk3s.echo.stage.bendProfile
import com.folk3s.echo.stage.fft
import com.folk3s.echo.stage.glassQuads
import com.folk3s.echo.stage.glassUniforms
import com.folk3s.echo.stage.lyrics.Spring
import com.folk3s.echo.stage.lyrics.SpringParams
import com.folk3s.echo.stage.lyrics.buildTimeline
import com.folk3s.echo.stage.lyrics.fieldAt
import com.folk3s.echo.stage.lyrics.lineEdges
import com.folk3s.echo.stage.lyrics.step
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.sin
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The ported pure logic, checked the way the web's tests check the originals (docs/ANDROID_CLIENT.md).
class PortsTest {
  @Test
  fun `glass boxes become uniforms, empty and off-surface ones left out`() {
    val r = floatArrayOf(24f, 24f, 24f, 24f)
    val (rects, corners, n) =
      glassUniforms(
        412f,
        915f,
        listOf(GlassBox(10f, 10f, 0f, 48f, r), GlassBox(412f, 10f, 48f, 48f, r), GlassBox(0f, 820f, 412f, 95f, FloatArray(4)), GlassBox(300f, 24f, 48f, 48f, r)),
        2,
      )
    assertEquals(2, n)
    assertArrayEquals(floatArrayOf(0f, 820f, 412f, 95f, 300f, 24f, 48f, 48f), rects, 0f)
    assertEquals(24f, corners[4])
  }

  @Test
  fun `the glass pass's quads face the camera`() {
    val q = glassQuads(floatArrayOf(103f, 0f, 206f, 229f), 1, 412f, 915f)
    for (t in listOf(0, 9)) {
      val area = (q[t + 3] - q[t]) * (q[t + 7] - q[t + 1]) - (q[t + 6] - q[t]) * (q[t + 4] - q[t + 1])
      assertTrue("counter-clockwise", area > 0)
    }
    assertEquals(-0.5f, q.filterIndexed { i, _ -> i % 3 == 0 }.min(), 1e-5f)
  }

  @Test
  fun `the bend is strongest at the edge and gone on the flat top`() {
    val g = GlassParams()
    val p = bendProfile(g)
    assertTrue(p[0] > p[8] && p[8] > 0)
    assertEquals(0.0, bend(g, 1.0), 1e-6)
    assertEquals(0.0, bend(g.copy(ior = 1.0), 0.0), 1e-6)
  }

  private fun doc(vararg lines: Pair<String, Long>) =
    LyricsDoc(trackKey = "navidrome:t", sync = "word", source = "fixture", attribution = Attribution("x"), lines = lines.map { (text, start) ->
      LyricLine(text, start, start + 900, words = listOf(LyricWord(text, start, start + 900)))
    })

  @Test
  fun `the timeline hands over before each line and coalesces lines too close together`() {
    val tl = buildTimeline(doc("one" to 10_000, "two" to 12_000, "three" to 12_100))
    // "three" hands over 280 ms after "two" (its lead is clamped to 120 ms): "two" never takes the anchor (§9.9).
    assertTrue(1 in tl.coalesced)
    assertEquals(0, fieldAt(tl, 10_000.0).active)
    assertEquals(-1, fieldAt(tl, 5_000.0).active)
    assertTrue("interlude dots before a long intro", fieldAt(tl, 5_000.0).dots)
    assertEquals(2, fieldAt(tl, 12_100.0).active)
  }

  @Test
  fun `the sweep edge crosses each word in its own time`() {
    val words = listOf(LyricWord("a", 0, 1000), LyricWord("b", 1000, 2000))
    val e = lineEdges(words, listOf(100f, 100f), 500.0)
    assertEquals(0.5, e[0], 1e-9)
    assertTrue("the next word is reached by the fade ahead", e[1] < 0 && e[1] > -1)
  }

  @Test
  fun `springs land in the same place at any frame rate`() {
    val p = SpringParams(2.0, 0.8)
    val a = Spring(0.0)
    val b = Spring(0.0)
    repeat(60) { step(a, 1.0, p, 1000.0 / 60) }
    repeat(144) { step(b, 1.0, p, 1000.0 / 144) }
    assertEquals(a.x, b.x, 1e-9)
  }

  @Test
  fun `reverb never changes the light faster than the photosensitivity limit`() {
    val r = Reverb()
    var last = r.step(Features(available = true, intensity = 0.9), 16.7, 0.5, 0.4)
    repeat(120) { i ->
      val f = Features(available = true, bass = if (i % 2 == 0) 1.0 else 0.0, onset = 1.0, intensity = 0.9)
      val next = r.step(f, 16.7, 0.5, 0.4)
      // Rising light (exposure up) stays inside the budget per frame.
      assertTrue(next.exposure - last.exposure <= LUMA_SLEW_PER_S * 0.0167 + 1e-9)
      last = next
    }
  }

  @Test
  fun `css colours parse like the web's`() {
    assertEquals(0xFFE3B26B.toInt(), parseCss("#E3B26B").toArgb())
    val glow = parseCss("oklch(0.68 0.10 75 / 0.35)")
    assertEquals(0.35f, glow.a, 1e-6f)
  }

  @Test
  fun `the fft finds a sine in its bin`() {
    val n = 2048
    val re = DoubleArray(n) { sin(2 * PI * 64 * it / n) }
    val im = DoubleArray(n)
    fft(re, im)
    val peak = (0 until n / 2).maxBy { hypot(re[it], im[it]) }
    assertEquals(64, peak)
    assertTrue(abs(hypot(re[64], im[64]) - n / 2.0) < 1e-6)
  }
}
