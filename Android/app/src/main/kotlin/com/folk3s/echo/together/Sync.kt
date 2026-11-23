package com.folk3s.echo.together

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor

// Listen together's arithmetic, as on the web (src/client/together/sync.ts; docs/TOGETHER.md): the
// server's clock from this phone, where the song should be, and what the player does to be there.

/** Further apart than this, the player seeks back into step. */
const val DRIFT_MS = 300L

/** After a correction, the player gets this long to settle before the next one. */
const val SETTLE_MS = 2500L

/** This close to the end, a player that stopped is not started again. */
const val END_SLACK_MS = 2000L

/** Time to load a song before it has to play (a cue ahead of the session). */
const val LEAD_MS = 1500L

/**
 * offset = server time − local time. An answer to a request was stamped between sending and
 * receiving: the midpoint is right to within half the round trip, and the shortest round trip of
 * the recent samples wins. A pushed event only says the offset is at least `serverTime − received`.
 */
class ClockSync(private val keep: Int = 8) {
  private val samples = ArrayDeque<Pair<Double, Long>>()
  var offset: Double? = null
    private set

  fun request(serverTime: Long, sentAt: Long, receivedAt: Long) {
    val rtt = (receivedAt - sentAt).coerceAtLeast(0)
    samples.addLast(serverTime - (sentAt + receivedAt) / 2.0 to rtt)
    while (samples.size > keep) samples.removeFirst()
    offset = samples.minBy { it.second }.first
  }

  fun pushed(serverTime: Long, receivedAt: Long) {
    val low = (serverTime - receivedAt).toDouble()
    val o = offset
    if (o == null || low > o) offset = low
  }

  fun toServer(local: Long): Long = local + (offset ?: 0.0).toLong()
}

/** Where the song should be at server time [serverNow]. */
fun expectedPosition(playing: Boolean, startedAt: Long?, positionMs: Long, serverTime: Long, durationMs: Long, serverNow: Long): Long {
  val raw =
    when {
      playing && startedAt != null -> serverNow - startedAt
      playing -> positionMs + (serverNow - serverTime)
      else -> positionMs
    }
  val max = if (durationMs > 0) durationMs else Long.MAX_VALUE
  return raw.coerceIn(0, max)
}

data class Target(val trackId: String?, val playing: Boolean, val positionMs: Long, val durationMs: Long)

data class Local(val trackId: String?, val active: Boolean, val loading: Boolean, val positionMs: Long)

sealed interface Step {
  data class Load(val positionMs: Long, val play: Boolean) : Step
  data class Seek(val positionMs: Long) : Step
  data object Play : Step
  data class Pause(val positionMs: Long) : Step
  data object Stop : Step
}

/** Close enough while paused: within DRIFT_MS, or on the whole second before (a transcode's start). */
private fun near(local: Long, target: Long) = abs(local - target) <= DRIFT_MS || local == floor(target / 1000.0).toLong() * 1000

/** What the player does to follow the session (sync.ts's `plan`). */
fun plan(target: Target, local: Local, settling: Boolean = false): Step? {
  if (target.trackId == null) return if (local.trackId != null && local.active) Step.Stop else null
  if (local.trackId != target.trackId) return Step.Load(target.positionMs, target.playing)
  if (local.loading) return null
  if (!target.playing) return if (local.active || !near(local.positionMs, target.positionMs)) Step.Pause(target.positionMs) else null
  val ending = target.durationMs > 0 && target.positionMs >= target.durationMs - END_SLACK_MS
  val far = abs(local.positionMs - target.positionMs) > DRIFT_MS
  if (!local.active) return if (ending) null else if (far) Step.Seek(target.positionMs) else Step.Play
  if (ending && target.positionMs >= target.durationMs) return null
  if (settling) return null
  return if (far) Step.Seek(target.positionMs) else null
}

/** Cue on the first whole second at least LEAD_MS ahead; wait until then. No room near the end. */
fun cuePoint(positionMs: Long, durationMs: Long): Pair<Long, Long> {
  val at = ceil((positionMs + LEAD_MS) / 1000.0).toLong() * 1000
  if (durationMs > 0 && at >= durationMs - 1000) return positionMs to 0L
  return at to at - positionMs
}

/** The session id in a scanned or opened link, if it is one for this server (`<origin>/together/<id>`). */
fun togetherIdOf(link: String, base: String): String? {
  val prefix = "${base.trimEnd('/')}/together/"
  if (!link.startsWith(prefix)) return null
  return link.removePrefix(prefix).trimEnd('/').takeIf { Regex("^[\\w-]{16,64}$").matches(it) }
}
