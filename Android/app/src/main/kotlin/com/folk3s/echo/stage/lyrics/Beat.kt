package com.folk3s.echo.stage.lyrics

import com.folk3s.echo.api.LyricWord
import com.folk3s.echo.stage.Features
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

// The lyric field's response to the music (beat.ts; LYRICS_EXPERIENCE.md §12): one set of beat
// terms per frame, with the readability caps of §12.4 applied after summing.

private fun smoothstep(a: Double, b: Double, x: Double): Double {
  val k = ((x - a) / (b - a)).coerceIn(0.0, 1.0)
  return k * k * (3 - 2 * k)
}

private val W0 = 2 * PI * Springs.impulse.f
private val WD = W0 * sqrt(1 - Springs.impulse.zeta * Springs.impulse.zeta)
private val T_PEAK = atan2(WD, Springs.impulse.zeta * W0) / WD

/** The kick that makes a unit impulse peak at 1. */
val UNIT_KICK = WD / (exp(-Springs.impulse.zeta * W0 * T_PEAK) * sin(WD * T_PEAK))

data class BeatTerms(val g: Double, val pulse: Double, val sustain: Double, val glowAdd: Double)

class Beat {
  private val bass = Spring()
  private var sustainV = 0.0
  private var intense = 0.0

  fun update(ft: Features, dt: Double, sinceHandover: Double, vocal: Double, mode: Mode, reduced: Boolean): BeatTerms {
    val on = ft.available && !reduced
    val g = if (ft.available) 0.35 + 0.65 * ft.intensity.coerceIn(0.0, 1.0) else 0.6
    val still = mode == Mode.Still
    if (still || !on) snap(bass, 0.0)
    else {
      step(bass, 0.0, Springs.impulse, dt)
      if (mode == Mode.Run) bass.v += L.Beat.bassForce * UNIT_KICK * ft.bassImpulse * dt
    }
    val v = vocal.coerceIn(0.0, 1.0)
    if (still) sustainV = v
    else {
      val tau = if (v > sustainV) L.Beat.sustainAttackMs else L.Beat.sustainReleaseMs
      sustainV += (v - sustainV) * (1 - exp(-dt / tau))
    }
    val intenseOn = ft.available && ft.intensity > L.Beat.intenseAbove
    intense = if (still) (if (intenseOn) 1.0 else 0.0) else (intense + (if (intenseOn) 1 else -1) * dt / L.Beat.passageMs).coerceIn(0.0, 1.0)
    val gate = if (on) smoothstep(L.Beat.quietMs, L.Beat.quietMs + 100, sinceHandover) else 0.0
    return BeatTerms(
      g,
      (L.Beat.scaleMax * g * bass.x * gate).coerceIn(-L.Beat.scaleCap, L.Beat.scaleCap),
      if (reduced) 0.0 else sustainV,
      if (reduced) 0.0 else L.Beat.intenseGlow * intense,
    )
  }
}

/** The sustained-vocal heuristic (§12.3) for the active line at `t`. */
fun vocalAt(words: List<LyricWord>?, lineActive: Boolean, mid: Double, t: Double): Double {
  if (!lineActive) return 0.0
  if (words.isNullOrEmpty()) return mid
  val w = words.firstOrNull { t >= it.start && t < it.end } ?: return 0.0
  return smoothstep(600.0, 1500.0, t - w.start) * mid
}

/** Glow alpha and radius for a sustain level (§12.3), capped at alphaMax. */
fun glowFor(sustain: Double, add: Double) =
  min(L.Glow.alphaMax, L.Glow.alpha + (L.Glow.alphaMax - L.Glow.alpha) * sustain + add) to (L.Glow.radius + (L.Glow.radiusMax - L.Glow.radius) * sustain)
