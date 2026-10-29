package com.folk3s.echo.stage.lyrics

import com.folk3s.echo.api.LyricLine
import com.folk3s.echo.api.LyricsDoc
import kotlin.math.max

// Time → field state (timing.ts; LYRICS_EXPERIENCE.md §5.3, §9.8, §9.9): pure functions of the
// document and song time; springs only smooth the result (§6.2).

/** Who holds the anchor from `from`: a line, or nobody (−1); `next` is the first line to come. */
data class Span(val from: Double, val line: Int, val next: Int, var dotsUntil: Double = Double.NEGATIVE_INFINITY)

class Timeline(
  val lines: List<LyricLine>,
  val ends: List<Double>,
  val handovers: List<Double>,
  val coalesced: Set<Int>,
  val spans: List<Span>,
)

fun buildTimeline(doc: LyricsDoc): Timeline {
  if (doc.sync == "none") {
    return Timeline(doc.lines.filter { it.text.isNotBlank() }, emptyList(), emptyList(), emptySet(), listOf(Span(0.0, -1, 0)))
  }
  // A line-timed line without `end` ends 100 ms before the next timed line, empty ones included.
  val all = doc.lines
  val ended =
    all.mapIndexed { i, l ->
      val next = all.getOrNull(i + 1)
      val end = l.end?.toDouble() ?: l.words?.lastOrNull()?.end?.toDouble() ?: (next?.let { it.start - L.LineTimed.endGapMs } ?: (l.start + L.LineTimed.lastLineMs))
      l to end
    }
  val kept = ended.filter { it.first.text.isNotBlank() }
  val lines = kept.map { it.first }
  val ends = kept.map { it.second }
  val n = lines.size
  if (n == 0) return Timeline(lines, ends, emptyList(), emptySet(), listOf(Span(0.0, -1, 0)))

  fun start(i: Int) = lines[i].start.toDouble()
  fun sungEnd(i: Int) = lines[i].words?.lastOrNull()?.end?.toDouble() ?: ends[i]

  val handovers = ArrayList<Double>(n)
  for (i in 0 until n) {
    val lead = if (i == 0) L.Handover.leadMaxMs else (start(i) - sungEnd(i - 1)).coerceIn(L.Handover.leadMinMs, L.Handover.leadMaxMs)
    handovers += max(start(i) - lead, handovers.getOrNull(i - 1) ?: Double.NEGATIVE_INFINITY)
  }
  fun isGap(i: Int) = start(i) - (if (i == 0) 0.0 else ends[i - 1]) >= L.Interlude.minGapMs
  // A line followed by the next hand-over within 350 ms never takes the anchor (§9.9).
  val coalesced = (0 until n - 1).filter { handovers[it + 1] - handovers[it] < L.Handover.coalesceMs }.toSet()

  val spans = mutableListOf(Span(0.0, -1, 0))
  if (isGap(0)) spans[0].dotsUntil = handovers[0] - L.Interlude.leaveMs
  for (i in 0 until n) {
    if (i > 0 && isGap(i)) spans += Span(ends[i - 1], -1, i, handovers[i] - L.Interlude.leaveMs)
    if (i !in coalesced) spans += Span(handovers[i], i, i + 1)
  }
  spans += Span(max(ends[n - 1], handovers[n - 1]), -1, n)
  return Timeline(lines, ends, handovers, coalesced, spans)
}

data class FieldState(val active: Int, val next: Int, val handoverAt: Double, val phase: Double, val dots: Boolean, val from: Double)

fun fieldAt(tl: Timeline, t: Double): FieldState {
  var i = 0
  while (i + 1 < tl.spans.size && tl.spans[i + 1].from <= t) i++
  val s = tl.spans[i]
  val handoverAt = tl.spans.getOrNull(i + 1)?.from ?: Double.POSITIVE_INFINITY
  val from = if (s.line >= 0) tl.lines[s.line].start.toDouble() else s.from
  val span = handoverAt - from
  val phase = if (handoverAt == Double.POSITIVE_INFINITY) 0.0 else if (span > 0) ((t - from) / span).coerceIn(0.0, 1.0) else 1.0
  return FieldState(s.line, s.next, handoverAt, phase, t < s.dotsUntil, s.from)
}
