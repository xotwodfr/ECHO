package com.folk3s.echo

import com.folk3s.echo.playback.AudioMath
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// v0.8: crossfade, the equalizer and Karaoke's key (playback/AudioMath.kt); the web's twins are
// tested in src/client/playback/{crossfade,eq,pitch}.test.ts.
class AudioMathTest {
  @Test
  fun fadesAreEqualPower() {
    for (i in 0..20) {
      val t = i / 20f
      val a = AudioMath.fadeOut(t)
      val b = AudioMath.fadeIn(t)
      assertEquals(1f, a * a + b * b, 1e-5f)
    }
    assertEquals(1f, AudioMath.fadeOut(0f), 0f)
    assertEquals(0f, AudioMath.fadeIn(0f), 0f)
    assertEquals(1f, AudioMath.fadeIn(1f), 1e-6f)
    assertEquals(0f, AudioMath.fadeOut(1f), 1e-6f)
    // Halfway each is at −3 dB, so the sum doesn't dip; out of range is clamped.
    assertEquals(-3.01, 20 * kotlin.math.log10(AudioMath.fadeIn(0.5f).toDouble()), 0.01)
    assertEquals(1f, AudioMath.fadeIn(2f), 1e-6f)
  }

  @Test
  fun crossfadesBetweenAlbumsNeverWithinOne() {
    assertTrue(AudioMath.crossfadeBetween("a", "b", "1", "2"))
    assertFalse(AudioMath.crossfadeBetween("a", "a", "1", "2"))
    assertFalse(AudioMath.crossfadeBetween("a", "b", "1", "1"))
    // No album known: the songs fade.
    assertTrue(AudioMath.crossfadeBetween(null, null, "1", "2"))
    assertTrue(AudioMath.crossfadeBetween("", "", "1", "2"))
  }

  @Test
  fun semitonesAreEqualTemperament() {
    assertEquals(1f, AudioMath.semitoneRatio(0), 0f)
    assertEquals(2f, AudioMath.semitoneRatio(12), 1e-6f)
    assertEquals(1.059463f, AudioMath.semitoneRatio(1), 1e-6f)
    assertEquals(0.7071068f, AudioMath.semitoneRatio(-6), 1e-6f)
  }

  @Test
  fun theKeyAppliesOnlyInKaraoke() {
    assertEquals(0, AudioMath.effectiveKey(false, 4))
    assertEquals(4, AudioMath.effectiveKey(true, 4))
    assertEquals(-6, AudioMath.effectiveKey(true, -11))
  }

  @Test
  fun presetsAreReadOffAtThePhonesBands() {
    val bass = AudioMath.eqPoints("bass", emptyList(), emptyList())
    // On a band: its own gain; between bands: on the line, on a log axis.
    assertEquals(6f, AudioMath.curveAt(bass, 31), 1e-6f)
    assertEquals(5f, AudioMath.curveAt(bass, 62), 1e-6f)
    assertEquals(4.5f, AudioMath.curveAt(bass, 88), 0.05f) // √(62·125)
    assertEquals(6f, AudioMath.curveAt(bass, 10), 1e-6f) // level beyond the ends
    val levels = AudioMath.eqLevels(bass, AudioMath.DEFAULT_DEVICE_BANDS)
    assertEquals(5, levels.size)
    assertTrue(levels[0] > 4f && abs(levels[4]) < 0.01f)
    // Flat is flat; an unknown preset is flat too.
    assertEquals(List(5) { 0f }, AudioMath.eqLevels(AudioMath.eqPoints("nope", emptyList(), emptyList()), AudioMath.DEFAULT_DEVICE_BANDS))
  }

  @Test
  fun customCurvesAreClampedAndBoostsLeaveHeadroom() {
    val pts = AudioMath.eqPoints("custom", listOf(60, 1000), listOf(20f, -3f))
    assertEquals(AudioMath.EQ_MAX_DB, AudioMath.curveAt(pts, 60), 0f)
    assertEquals(0.5f, AudioMath.eqHeadroom(listOf(6.0206f, 0f)), 1e-4f)
    assertEquals(1f, AudioMath.eqHeadroom(listOf(-3f, 0f)), 0f)
    assertEquals(1f, AudioMath.eqHeadroom(emptyList()), 0f)
  }

  @Test
  fun everyPresetHasTenBands() {
    for ((id, p) in AudioMath.EQ_PRESETS) assertEquals(id, AudioMath.EQ_BANDS.size, p.second.size)
  }
}
