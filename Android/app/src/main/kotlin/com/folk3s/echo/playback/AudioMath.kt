package com.folk3s.echo.playback

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The sums behind crossfade, the equalizer and Karaoke's key (docs/ANDROID_CLIENT.md, v0.8), kept
 * apart from Android so they are unit-tested: the web has the same in src/client/playback/
 * crossfade.ts, eq.ts and pitch.ts.
 */
object AudioMath {
  /** The longest crossfade Settings offers, in seconds. */
  const val MAX_CROSSFADE_S = 12

  /** Karaoke's key range in semitones, either way. */
  const val KEY_RANGE = 6

  /** Equal-power fade at `t` (0..1): the outgoing song's volume falls as cos, the incoming rises as sin. */
  fun fadeOut(t: Float): Float = cos(t.coerceIn(0f, 1f) * PI.toFloat() / 2)

  fun fadeIn(t: Float): Float = sin(t.coerceIn(0f, 1f) * PI.toFloat() / 2)

  /**
   * Whether two songs crossfade: not the same song, and not two of the same album, which often run
   * into each other (live albums, DJ mixes): those keep their gapless hand-over.
   */
  fun crossfadeBetween(albumA: String?, albumB: String?, idA: String?, idB: String?): Boolean =
    idA != idB && !(albumA != null && albumA.isNotEmpty() && albumA == albumB)

  /** A shift of [semitones] as a frequency ratio (equal temperament). */
  fun semitoneRatio(semitones: Int): Float = 2.0.pow(semitones / 12.0).toFloat()

  /** The key in effect: only while Karaoke is on (the value is kept while it's off), within ±6. */
  fun effectiveKey(karaoke: Boolean, key: Int): Int = if (karaoke) key.coerceIn(-KEY_RANGE, KEY_RANGE) else 0

  // ---- the equalizer ----

  /** The web's ten bands (eq.ts); the presets are given there and read off at the phone's bands. */
  val EQ_BANDS = intArrayOf(31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)

  const val EQ_MAX_DB = 12f

  /** The presets, ids as on the web, with their names. */
  val EQ_PRESETS: Map<String, Pair<String, FloatArray>> =
    linkedMapOf(
      "flat" to ("Flat" to floatArrayOf(0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f)),
      "bass" to ("Bass boost" to floatArrayOf(6f, 5f, 4f, 2f, 0f, 0f, 0f, 0f, 0f, 0f)),
      "treble" to ("Treble boost" to floatArrayOf(0f, 0f, 0f, 0f, 0f, 1f, 2f, 4f, 5f, 6f)),
      "vocal" to ("Vocal" to floatArrayOf(-2f, -2f, -1f, 0f, 2f, 4f, 4f, 2f, 0f, -1f)),
      "loudness" to ("Loudness" to floatArrayOf(5f, 4f, 2f, 0f, -1f, -1f, 0f, 2f, 4f, 5f)),
      "acoustic" to ("Acoustic" to floatArrayOf(4f, 4f, 3f, 1f, 1f, 1f, 2f, 3f, 3f, 2f)),
      "electronic" to ("Electronic" to floatArrayOf(4f, 4f, 1f, 0f, -2f, 1f, 0f, 1f, 4f, 5f)),
    )

  /** The phone's usual five bands, until its equalizer says otherwise. */
  val DEFAULT_DEVICE_BANDS = listOf(60, 230, 910, 3600, 14000)

  /**
   * The curve through `points` (Hz → dB) at [hz]: straight lines on a log-frequency axis between
   * them, level beyond the ends.
   */
  fun curveAt(points: List<Pair<Int, Float>>, hz: Int): Float {
    val p = points.filter { it.first > 0 }.sortedBy { it.first }
    if (p.isEmpty()) return 0f
    if (hz <= p.first().first) return p.first().second
    if (hz >= p.last().first) return p.last().second
    val i = p.indexOfLast { it.first <= hz }
    val (f0, g0) = p[i]
    val (f1, g1) = p[i + 1]
    val t = (ln(hz.toDouble()) - ln(f0.toDouble())) / (ln(f1.toDouble()) - ln(f0.toDouble()))
    return (g0 + (g1 - g0) * t).toFloat()
  }

  /** The curve the user chose: a preset's ten bands, or their own points (Hz → dB). */
  fun eqPoints(preset: String, customHz: List<Int>, custom: List<Float>): List<Pair<Int, Float>> {
    if (preset == "custom") return customHz.zip(custom).map { (f, g) -> f to g.coerceIn(-EQ_MAX_DB, EQ_MAX_DB) }
    val g = (EQ_PRESETS[preset] ?: EQ_PRESETS.getValue("flat")).second
    return EQ_BANDS.indices.map { EQ_BANDS[it] to g[it] }
  }

  /** The levels for the phone's [bands] in dB, rounded to tenths. */
  fun eqLevels(points: List<Pair<Int, Float>>, bands: List<Int>): List<Float> =
    bands.map { (curveAt(points, it) * 10).roundToInt() / 10f }

  /** Headroom, so boosts don't clip: the largest boost taken off the volume, as a gain. */
  fun eqHeadroom(levels: List<Float>): Float = 10.0.pow(-(levels.maxOrNull() ?: 0f).coerceAtLeast(0f) / 20.0).toFloat()
}
