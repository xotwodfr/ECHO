package com.folk3s.echo.stage

// The quality governor (src/client/stage/governor.ts; VISUALIZER_SPEC.md §8.2). Pure: the Stage
// feeds it frame intervals and applies the tier it returns. The refresh rate is the median of the
// first 60 intervals; a tier steps down after 1 s over budget and up after 8 s at full refresh,
// never in the first 3 s of a track or during a scrub, and never up within 20 s of any change. On
// its own it goes no lower than T2: T3 is Still, which measures nothing and could never come back.

enum class Tier(val dprCap: Float, val roomScale: Float, val bend: Boolean, val light: Boolean) {
  // The glass columns are GLASS_BY_TIER (§8.1): the bend is a dependent read of the room.
  T0(1.5f, 1 / 2f, true, true),
  T1(1.25f, 1 / 2f, true, true),
  T2(1.0f, 1 / 3f, false, true),
  T3(1.0f, 1 / 3f, false, false),
}

private const val ALPHA = 0.1
private const val DOWN_AFTER_MS = 1000.0
private const val UP_AFTER_MS = 8000.0
private const val SETTLE_MS = 20_000.0
private const val TRACK_START_MS = 3000.0
private const val EMERGENCY_MS = 3000.0
private const val EMERGENCY_FRAME_MS = 50.0
private const val FULL_RATE = 1.05
private const val GAP_MS = 250.0

class Governor(var tier: Tier, private val manual: Boolean, private val now: () -> Double) {
  private val intervals = ArrayList<Double>(60)
  var targetMs = 1000.0 / 60
    private set
  private var ema = 0.0
  private var over = 0.0
  private var under = 0.0
  private var slow = 0.0
  private var lastChange = Double.NEGATIVE_INFINITY

  private fun step(dir: Int): Tier? {
    val next = Tier.entries.getOrNull(tier.ordinal + dir) ?: return null
    if (next == Tier.T3 && !manual) return null
    tier = next
    lastChange = now()
    over = 0.0
    under = 0.0
    slow = 0.0
    return tier
  }

  /** One frame; the new tier when it changes, else null. */
  fun sample(dtMs: Double, trackMs: Double, scrubbing: Boolean): Tier? {
    if (dtMs <= 0 || dtMs > GAP_MS) return null
    if (intervals.size < 60) {
      intervals += dtMs
      if (intervals.size == 60) {
        targetMs = intervals.sorted()[30]
        ema = targetMs
      }
      return null
    }
    ema += ALPHA * (dtMs - ema)
    if (manual) {
      slow = if (ema > EMERGENCY_FRAME_MS) slow + dtMs else 0.0
      return if (slow >= EMERGENCY_MS) step(1) else null
    }
    if (trackMs < TRACK_START_MS || scrubbing) {
      over = 0.0
      under = 0.0
      return null
    }
    over = if (ema > 1.15 * targetMs) over + dtMs else 0.0
    under = if (ema <= FULL_RATE * targetMs) under + dtMs else 0.0
    if (over >= DOWN_AFTER_MS) return step(1)
    if (under >= UP_AFTER_MS && now() - lastChange >= SETTLE_MS) return step(-1)
    return null
  }
}

/** §8.2 first run: T1 on phone GPUs (Adreno, Mali, PowerVR, Xclipse) and software; T0 elsewhere. */
fun firstTier(renderer: String?): Tier {
  if (renderer == null) return Tier.T1
  val r = renderer.lowercase()
  if (listOf("swiftshader", "llvmpipe", "software", "intel", "apple", "mali", "adreno", "powervr", "xclipse", "immortalis").any { it in r }) return Tier.T1
  return if (listOf("nvidia", "geforce", "radeon", "amd").any { it in r }) Tier.T0 else Tier.T1
}
