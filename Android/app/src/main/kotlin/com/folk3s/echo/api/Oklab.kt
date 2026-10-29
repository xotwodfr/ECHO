package com.folk3s.echo.api

import kotlin.math.PI
import kotlin.math.cbrt
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

// OKLab / OKLCH ↔ linear sRGB (src/shared/oklab.ts, Björn Ottosson's matrices): the server sends the
// album palette as CSS oklch(), the Stage wants linear light and Compose wants sRGB.

/** Linear sRGB, 0..1 per channel, and alpha. */
data class Linear(val r: Float, val g: Float, val b: Float, val a: Float = 1f)

fun oklabToLinear(l0: Double, a: Double, b: Double): DoubleArray {
  val l = (l0 + 0.3963377774 * a + 0.2158037573 * b).pow(3)
  val m = (l0 - 0.1055613458 * a - 0.0638541728 * b).pow(3)
  val s = (l0 - 0.0894841775 * a - 1.291485548 * b).pow(3)
  return doubleArrayOf(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  )
}

fun linearToOklab(r: Double, g: Double, b: Double): DoubleArray {
  val l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  val m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  val s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return doubleArrayOf(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  )
}

fun srgbToLinear(c: Double) = if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)

fun linearToSrgb(c: Double) = if (c <= 0.0031308) 12.92 * c else 1.055 * c.pow(1 / 2.4) - 0.055

/** A CSS number or percentage; `pct` is what 100% means. */
private fun num(token: String, pct: Double = 1.0): Double {
  val v = token.trimEnd('%').toDouble()
  return if (token.endsWith('%')) v / 100 * pct else v
}

private fun hue(token: String): Double {
  val v = token.filter { it.isDigit() || it == '.' || it == '-' }.toDouble()
  return when {
    token.endsWith("turn") -> v * 360
    token.endsWith("grad") -> v * 0.9
    token.endsWith("rad") -> v * 180 / PI
    else -> v
  }
}

/** `#rgb[a]`, `#rrggbb[aa]` and `oklch(L C H [/ A])`, as linear sRGB (gamut-clipped) and alpha. */
fun parseCss(css: String): Linear {
  val s = css.trim().lowercase()
  if (s.startsWith('#')) {
    val hex = s.drop(1).let { h -> if (h.length <= 4) h.map { "$it$it" }.joinToString("") else h }
    require(hex.length == 6 || hex.length == 8) { "unsupported colour: $css" }
    fun byte(i: Int) = hex.substring(i * 2, i * 2 + 2).toInt(16) / 255.0
    return Linear(
      srgbToLinear(byte(0)).toFloat(),
      srgbToLinear(byte(1)).toFloat(),
      srgbToLinear(byte(2)).toFloat(),
      if (hex.length == 8) byte(3).toFloat() else 1f,
    )
  }
  val body = s.removePrefix("oklch(").removeSuffix(")")
  require(body != s) { "unsupported colour: $css" }
  val parts = body.split('/')
  val (l, c, h) = parts[0].trim().split(Regex("\\s+"))
  val hr = hue(h) * PI / 180
  val rgb = oklabToLinear(num(l), num(c, 0.4) * cos(hr), num(c, 0.4) * sin(hr))
  fun clip(v: Double) = v.coerceIn(0.0, 1.0).toFloat()
  return Linear(clip(rgb[0]), clip(rgb[1]), clip(rgb[2]), parts.getOrNull(1)?.let { num(it.trim()).toFloat() } ?: 1f)
}

/** Opaque sRGB as an ARGB int, for Compose. */
fun Linear.toArgb(): Int {
  fun ch(v: Float) = (linearToSrgb(v.toDouble().coerceIn(0.0, 1.0)) * 255 + 0.5).toInt()
  return (0xFF shl 24) or (ch(r) shl 16) or (ch(g) shl 8) or ch(b)
}
