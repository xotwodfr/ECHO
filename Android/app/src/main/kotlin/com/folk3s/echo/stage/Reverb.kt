package com.folk3s.echo.stage

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

// Reverb mode's per-frame state (src/client/stage/reverb.ts; VISUALIZER_SPEC.md §4.2–§4.5, §7):
// flow from intensity, bass breathing, onset rings (≤ 3), the key flare, feedback decay and warp,
// scaled by the intensity setting and held under the photosensitivity limit (§7.3), which always
// has the last word. Pure: the renderer only uploads what this returns.

enum class Intensity(val breathe: Double, val threshold: Double, val i0Cap: Double, val rings: Int, val flowHigh: Double, val poolBass: Double, val decay: Double) {
  Subtle(0.05, 0.55, 0.12, 2, 1.3, 0.03, -0.02),
  Balanced(0.1, 0.35, 0.22, 3, 1.6, 0.06, 0.0),
  Expressive(0.15, 0.25, 0.22, 3, 2.0, 0.09, 0.02),
}

/** §7.3: all luminance-driving terms together change by at most this per second. */
const val LUMA_SLEW_PER_S = 0.24
private const val RING_SPEED = 0.55 // H per second
private const val FLARE = 0.15
private const val FLARE_MS = 120.0

data class Ring(val x: Double, val y: Double, var age: Double, val i0: Double, val tau: Double) {
  /** Ring light at its age: I₀·e^{−age/τ}. */
  fun light() = i0 * exp(-age / tau)

  fun radius() = RING_SPEED * age
}

data class ReverbFrame(
  val flow: Double,
  val exposure: Double,
  val rings: List<Ring>,
  val flare: Double,
  val decay: Double,
  val warp: Double,
  val poolScale: Double,
  val keyScale: Double,
)

class Reverb(private val s: Intensity = Intensity.Expressive, seed: Long = 1) {
  private var flow = 0.0
  private var rings = mutableListOf<Ring>()
  private var flareMs = 0.0
  private var shownExposure = 1.0
  private var shownRings = 0.0
  private var shownFlare = 0.0
  private var rnd = seed and 0xFFFFFFFFL

  private fun rand(): Double {
    rnd = (rnd * 1664525 + 1013904223) and 0xFFFFFFFFL
    return rnd / 4294967296.0
  }

  fun step(f: Features, dtMs: Double, keyX: Double, keyY: Double): ReverbFrame {
    val dt = dtMs / 1000
    val it = if (f.available) f.intensity else 0.6
    val g = 0.35 + 0.65 * it
    val busy = if (it > 0.75) s.flowHigh else 1.0
    flow += (if (it < 0.2) 0.04 else (0.04 + 0.1 * it) * busy) * dt

    val threshold = if (it < 0.2) max(0.5, s.threshold) else s.threshold
    for (r in rings) r.age += dt
    rings.removeAll { it.light() <= 0.002 }
    if (f.available && f.onset > threshold) {
      val atKey = rand() < 0.7
      val ring =
        Ring(
          x = if (atKey) keyX else 0.2 + 0.6 * rand(),
          y = if (atKey) keyY else 0.2 + 0.5 * rand(),
          age = 0.0,
          i0 = min(s.i0Cap, 0.1 + 0.12 * f.onset),
          tau = 0.45 + 0.6 * (1 - it),
        )
      if (rings.size >= s.rings) {
        rings.sortByDescending { it.age }
        rings.removeAt(0)
      }
      rings += ring
      flareMs = FLARE_MS
    }
    flareMs = max(0.0, flareMs - dtMs)

    val breathe = if (it < 0.2) min(0.03, s.breathe) else s.breathe
    val wantExposure = 1 + breathe * g * (if (f.available) f.bass else 0.0)
    val wantRings = rings.sumOf { it.light() }
    val wantFlare = if (flareMs > 0) FLARE else 0.0

    // §7.3: the combined change is slew-limited; ring and flare light may fall at once.
    shownRings = min(shownRings, wantRings)
    shownFlare = min(shownFlare, wantFlare)
    val budget = LUMA_SLEW_PER_S * dt
    val d0 = wantExposure - shownExposure
    val d1 = wantRings - shownRings
    val d2 = wantFlare - shownFlare
    val total = abs(d0) + abs(d1) + abs(d2)
    val k = if (total > budget) budget / total else 1.0
    shownExposure += d0 * k
    shownRings += d1 * k
    shownFlare += d2 * k
    val ringGain = if (wantRings > 0) min(1.0, shownRings / wantRings) else 0.0

    return ReverbFrame(
      flow = flow,
      exposure = shownExposure,
      rings = rings.map { it.copy(i0 = it.i0 * ringGain) },
      flare = shownFlare,
      decay = min(0.97, 0.9 + 0.06 * (1 - it) + s.decay),
      warp = min(0.003, 0.002 * (1 + 0.5 * (if (f.available) f.high else 0.0))),
      poolScale = 1 + s.poolBass * (if (f.available) f.bass else 0.0),
      keyScale = 1 + 0.08 * (if (f.available) f.sub else 0.0),
    )
  }
}

/** §7.3: ring and flare tints never read as saturated red, R/(R+G+B) < 0.8. */
fun safeTint(r: Float, g: Float, b: Float): FloatArray {
  val sum = r + g + b
  if (sum <= 0 || r / sum < 0.8f) return floatArrayOf(r, g, b)
  val lift = (r / 0.79f - sum) / 2
  return floatArrayOf(r, g + lift, b + lift)
}
