package com.folk3s.echo.stage

import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tan

// Liquid glass (DESIGN_SYSTEM.md §7.11; src/client/ui/glass.ts): the bend across a convex squircle
// rim by Snell's law, and the boxes the Stage's glass pass draws. The --glass-* tokens as values.

data class GlassParams(
  val thickness: Double = 24.0, // dp
  val bezel: Double = 20.0, // dp
  val ior: Double = 1.5,
  val refraction: Double = 1.0,
  val specular: Double = 0.5,
  val light: Double = 135.0, // degrees anticlockwise from +x: from the top left
  val saturate: Double = 1.5,
  val frost: Double = 8.0, // dp, regular glass (panels); the Stage's controls are clear glass
)

/** The rim's height, 0 at the outer edge to 1 where the flat top starts. */
private fun rim(t: Double) = (1 - (1 - t).pow(4)).pow(0.25)

/** How far (dp) the view through the rim shifts inward at fraction `t` across it (0 = the edge). */
fun bend(g: GlassParams, t: Double): Double {
  val dt = 1e-4
  val slope = (rim(min(t + dt, 1.0)) - rim(t)) / dt
  val incidence = atan(slope)
  val deviation = incidence - asin(sin(incidence) / g.ior)
  return (g.thickness + rim(t) * g.bezel) * tan(deviation)
}

/** The bend at `n` even steps (edge first), refraction applied: the shader's lookup. */
fun bendProfile(g: GlassParams, n: Int = GLASS_STEPS) = FloatArray(n) { i -> (bend(g, i / (n - 1.0)) * g.refraction).toFloat() }

data class GlassBox(val x: Float, val y: Float, val w: Float, val h: Float, val radii: FloatArray)

/**
 * Boxes (dp, relative to the surface) as the glass pass's uniforms: x, y, w, h and the corner
 * radii in CSS order, four floats each; no area or wholly off the surface are left out; at most `max`.
 */
fun glassUniforms(surfaceW: Float, surfaceH: Float, boxes: List<GlassBox>, max: Int = GLASS_MAX): Triple<FloatArray, FloatArray, Int> {
  val rects = FloatArray(max * 4)
  val corners = FloatArray(max * 4)
  var n = 0
  for (b in boxes) {
    if (n == max) break
    val off = b.x >= surfaceW || b.y >= surfaceH || b.x + b.w <= 0 || b.y + b.h <= 0
    if (b.w < 1 || b.h < 1 || off) continue
    floatArrayOf(b.x, b.y, b.w, b.h).copyInto(rects, n * 4)
    b.radii.copyInto(corners, n * 4, 0, 4)
    n++
  }
  return Triple(rects, corners, n)
}

/** The boxes as clip-space triangles, two per box, counter-clockwise (back faces are culled). */
fun glassQuads(rects: FloatArray, count: Int, w: Float, h: Float): FloatArray {
  val out = FloatArray(count * 18)
  for (i in 0 until count) {
    val x = rects[i * 4]
    val y = rects[i * 4 + 1]
    val x0 = x / w * 2 - 1
    val x1 = (x + rects[i * 4 + 2]) / w * 2 - 1
    val y0 = 1 - y / h * 2
    val y1 = 1 - (y + rects[i * 4 + 3]) / h * 2
    floatArrayOf(x0, y1, 0f, x1, y1, 0f, x1, y0, 0f, x0, y1, 0f, x1, y0, 0f, x0, y0, 0f).copyInto(out, i * 18)
  }
  return out
}
