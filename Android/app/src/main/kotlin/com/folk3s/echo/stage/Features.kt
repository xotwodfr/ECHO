package com.folk3s.echo.stage

import com.folk3s.echo.playback.AudioTap
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** One frame's audio features (src/shared/types.ts Features, VISUALIZER_SPEC.md §3.4). */
data class Features(
  val available: Boolean = false,
  val sub: Double = 0.0,
  val bass: Double = 0.0,
  val mid: Double = 0.0,
  val high: Double = 0.0,
  val onset: Double = 0.0,
  val intensity: Double = 0.6,
  val bassImpulse: Double = 0.0,
) {
  companion object {
    /** No audio to analyse: everything 0 but intensity (§3.4). */
    val SILENT = Features()
  }
}

private class Band(val lo: Double, val hi: Double, val attackMs: Double, val releaseMs: Double)

private val BANDS =
  listOf(
    Band(20.0, 60.0, 10.0, 180.0), // sub
    Band(20.0, 250.0, 10.0, 180.0), // bass
    Band(250.0, 4000.0, 25.0, 250.0), // mid
    Band(4000.0, 12000.0, 5.0, 120.0), // high
  )
private const val FFT = 2048
private const val BINS = FFT / 2
private const val DB_MIN = -100.0
private const val DB_FLOOR = -60.0
private const val BUCKETS = 64
private const val DECAY = 0.995
private const val FLUX_WINDOW = 90
private const val ONSET_GAP_MS = 120.0
private const val RATE_WINDOW_MS = 4000.0

/** A running 95th percentile of dB values: a 64-bucket histogram that forgets 0.5% per frame. */
private class P95 {
  private val h = DoubleArray(BUCKETS)
  private var total = 0.0

  fun add(db: Double) {
    for (i in 0 until BUCKETS) h[i] *= DECAY
    total = total * DECAY + 1
    val k = floor((db - DB_MIN) / -DB_MIN * BUCKETS).toInt().coerceIn(0, BUCKETS - 1)
    h[k] += 1.0
  }

  fun value(): Double {
    var acc = 0.0
    for (i in 0 until BUCKETS) {
      acc += h[i]
      if (acc >= 0.95 * total) return max(DB_FLOOR, DB_MIN + (i + 1).toDouble() / BUCKETS * -DB_MIN)
    }
    return DB_FLOOR
  }
}

private fun toDb(power: Double) = if (power > 0) 10 * log10(power) else DB_MIN

private fun norm(db: Double, p95: Double) = min(1.0, max(0.0, 10.0.pow((db - p95) / 10)))

private fun onePole(prev: Double, x: Double, dtMs: Double, attackMs: Double, releaseMs: Double) =
  prev + (x - prev) * (1 - exp(-dtMs / (if (x > prev) attackMs else releaseMs)))

/**
 * Live features from the audio tap (src/client/playback/analyser.ts): the Web Audio analyser's
 * spectrum (2048-point FFT, Blackman window, magnitudes / N in dB) reproduced, then four bands with
 * one-pole envelopes normalised by their running p95, spectral-flux onsets against the median and
 * MAD of the last 1.5 s, RMS, intensity and bassImpulse. Nothing is allocated per frame.
 */
class AnalyserFeatures {
  private val time = FloatArray(FFT)
  private val re = DoubleArray(FFT)
  private val im = DoubleArray(FFT)
  private val spectrum = DoubleArray(BINS)
  private val prevMag = DoubleArray(BINS)
  private val window = DoubleArray(FFT) { i -> 0.42 - 0.5 * cos(2 * PI * i / FFT) + 0.08 * cos(4 * PI * i / FFT) }
  private val bandP95 = Array(BANDS.size) { P95() }
  private val rmsP95 = P95()
  private val env = DoubleArray(BANDS.size)
  private val flux = DoubleArray(FLUX_WINDOW)
  private val sorted = DoubleArray(FLUX_WINDOW)
  private var fluxN = 0
  private var fluxAt = 0
  private val onsets = DoubleArray(64) { Double.NEGATIVE_INFINITY }
  private var onsetHead = 0
  private var lastOnset = Double.NEGATIVE_INFINITY
  private var rms = 0.0
  private var intensity = 0.6
  private var prevBass = 0.0
  private var now = 0.0
  private var last = Features.SILENT

  fun sample(dtMs: Double): Features {
    if (dtMs <= 0) return last
    if (!AudioTap.window(time)) {
      last = Features.SILENT
      return last
    }
    now += dtMs
    spectrumOf(time)
    val hzPerBin = AudioTap.sampleRate / 2.0 / BINS
    fun bin(hz: Double) = (hz / hzPerBin).roundToInt().coerceIn(0, BINS - 1)

    val values = DoubleArray(BANDS.size)
    for ((b, band) in BANDS.withIndex()) {
      var p = 0.0
      for (i in bin(band.lo)..bin(band.hi)) p += 10.0.pow(spectrum[i] / 10)
      val db = toDb(p)
      bandP95[b].add(db)
      env[b] = onePole(env[b], norm(db, bandP95[b].value()), dtMs, band.attackMs, band.releaseMs)
      values[b] = env[b]
    }

    // Spectral flux over 2–12 kHz (half-wave rectified, log magnitude).
    var f = 0.0
    val lo = bin(2000.0)
    val hi = bin(12000.0)
    for (i in lo..hi) {
      val d = spectrum[i] - prevMag[i]
      if (d > 0) f += d
      prevMag[i] = spectrum[i]
    }
    flux[fluxAt] = f
    fluxAt = (fluxAt + 1) % FLUX_WINDOW
    fluxN = min(FLUX_WINDOW, fluxN + 1)
    for (i in 0 until fluxN) sorted[i] = flux[i]
    val median = medianOfSorted()
    for (i in 0 until fluxN) sorted[i] = abs(flux[i] - median)
    val mad = medianOfSorted()
    val threshold = median + 1.5 * mad + 0.5 * (hi - lo + 1)
    var onset = 0.0
    if (fluxN >= 10 && f > threshold && now - lastOnset >= ONSET_GAP_MS) {
      onset = min(1.0, (f - threshold) / threshold)
      lastOnset = now
      onsets[onsetHead] = now
      onsetHead = (onsetHead + 1) % onsets.size
    }

    var sq = 0.0
    for (s in time) sq += s * s
    val rmsDb = toDb(sq / FFT)
    rmsP95.add(rmsDb)
    rms = onePole(rms, norm(rmsDb, rmsP95.value()), dtMs, 300.0, 300.0)
    val recent = onsets.count { now - it < RATE_WINDOW_MS }
    val rate = min(1.0, recent / (RATE_WINDOW_MS / 1000) / 4)
    intensity = onePole(intensity, 0.7 * rms + 0.3 * rate, dtMs, 2000.0, 2000.0)

    val bass = values[1]
    val impulse = min(1.0, max(0.0, (bass - prevBass) / max(1.0, dtMs) * 40))
    prevBass = bass
    last = Features(true, values[0], bass, values[2], values[3], onset, intensity, impulse)
    return last
  }

  private fun medianOfSorted(): Double {
    java.util.Arrays.sort(sorted, 0, fluxN)
    val m = fluxN shr 1
    return if (fluxN % 2 == 1) sorted[m] else (sorted[m - 1] + sorted[m]) / 2
  }

  /** The analyser's dB spectrum: Blackman-windowed FFT, |X| / N, 20·log10. */
  private fun spectrumOf(x: FloatArray) {
    for (i in 0 until FFT) {
      re[i] = x[i] * window[i]
      im[i] = 0.0
    }
    fft(re, im)
    for (k in 0 until BINS) {
      val mag = sqrt(re[k] * re[k] + im[k] * im[k]) / FFT
      spectrum[k] = if (mag > 0) max(DB_MIN, 20 * log10(mag)) else DB_MIN
    }
  }
}

/** In-place iterative radix-2 FFT (n a power of two). */
internal fun fft(re: DoubleArray, im: DoubleArray) {
  val n = re.size
  var j = 0
  for (i in 1 until n) {
    var bit = n shr 1
    while (j and bit != 0) {
      j = j xor bit
      bit = bit shr 1
    }
    j = j xor bit
    if (i < j) {
      var t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  var len = 2
  while (len <= n) {
    val ang = -2 * PI / len
    val wr = cos(ang)
    val wi = sin(ang)
    var i = 0
    while (i < n) {
      var cr = 1.0
      var ci = 0.0
      for (k in 0 until len / 2) {
        val ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        val ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k + len / 2] = re[i + k] - ar
        im[i + k + len / 2] = im[i + k] - ai
        re[i + k] += ar
        im[i + k] += ai
        val nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
      i += len
    }
    len = len shl 1
  }
}
