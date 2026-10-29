package com.folk3s.echo.stage.lyrics

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

// Damped harmonic springs (springs.ts, LYRICS_EXPERIENCE.md §6.1), integrated in closed form: one
// step is the exact solution for a target held over `dt`, so the path does not depend on the frame
// rate and never goes unstable.

const val MAX_SPRING_DT_MS = 100.0

class Spring(var x: Double = 0.0, var v: Double = 0.0)

data class SpringParams(val f: Double, val zeta: Double)

fun step(s: Spring, target: Double, p: SpringParams, dtMs: Double): Spring {
  val t = dtMs.coerceIn(0.0, MAX_SPRING_DT_MS) / 1000
  if (t == 0.0) return s
  val w = 2 * PI * p.f
  val z = p.zeta
  val u0 = s.x - target
  val v0 = s.v
  val u: Double
  val v: Double
  if (abs(z - 1) < 1e-6) {
    val e = exp(-w * t)
    val b = v0 + w * u0
    u = (u0 + b * t) * e
    v = (b - w * (u0 + b * t)) * e
  } else if (z < 1) {
    val wd = w * sqrt(1 - z * z)
    val e = exp(-z * w * t)
    val c = cos(wd * t)
    val sn = sin(wd * t)
    val b = (v0 + z * w * u0) / wd
    u = e * (u0 * c + b * sn)
    v = e * ((b * wd - z * w * u0) * c - (u0 * wd + z * w * b) * sn)
  } else {
    val r = w * sqrt(z * z - 1)
    val r1 = -z * w + r
    val r2 = -z * w - r
    val c2 = (v0 - r1 * u0) / (r2 - r1)
    val c1 = u0 - c2
    val e1 = exp(r1 * t)
    val e2 = exp(r2 * t)
    u = c1 * e1 + c2 * e2
    v = c1 * r1 * e1 + c2 * r2 * e2
  }
  s.x = target + u
  s.v = v
  return s
}

fun snap(s: Spring, target: Double): Spring {
  s.x = target
  s.v = 0.0
  return s
}

object Springs {
  val slow = SpringParams(L.Springs.slow.first, L.Springs.slow.second)
  val lift = SpringParams(L.Springs.lift.first, L.Springs.lift.second)
  val impulse = SpringParams(L.Springs.impulse.first, L.Springs.impulse.second)
}

/** `line.normal` for a hand-over `gapMs` apart: 2.35 Hz at 100 ms down to 2.0 Hz at 800 ms. */
fun lineNormal(gapMs: Double): SpringParams {
  val n = ((gapMs - 100) / 700).coerceIn(0.0, 1.0)
  return SpringParams(L.Springs.fMin + (L.Springs.fMax - L.Springs.fMin) * (1 - n).pow(0.2), L.Springs.zNormal)
}
