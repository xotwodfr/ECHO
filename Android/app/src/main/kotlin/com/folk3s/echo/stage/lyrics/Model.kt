package com.folk3s.echo.stage.lyrics

import com.folk3s.echo.api.LyricLine
import com.folk3s.echo.api.LyricWord
import com.folk3s.echo.stage.Features
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

// The lyric field's motion per frame (model.ts; LYRICS_EXPERIENCE.md §4–§9): one column scrolled
// by springs from time, hand-over stagger, decay, word sweep, glow and emphasis. No drawing:
// LyricsField draws what this computes. A faithful port, so both clients move alike.

data class Rect(val x: Float, val y: Float, val w: Float, val h: Float)

data class Emphasis(val swell: Double, val lift: Double, val spread: Double, val stepMs: Double)

enum class Side { Centre, Left, Right }

class WordBox(val rect: Rect, val emphasis: Emphasis?, val graphemes: List<Rect>)

class LineBox(val w: Float, val h: Float, val side: Side, val words: List<WordBox>)

enum class Role { Zone, Past }

enum class Mode { Run, Scrub, Still }

class Leaving(val ms: Double, var age: Double, val from: Double)

class Inst(
  val i: Int,
  var role: Role,
  var rank: Int,
  val x: Spring,
  val y: Spring,
  val z: Spring,
  var params: SpringParams,
  var delay: Double,
  var tx: Double,
  var ty: Double,
  var tz: Double,
  var age: Double,
  words: Int,
  backing: List<Int>,
  emph: List<Int>,
  reduced: Boolean,
) {
  var leaving: Leaving? = null
  var scale = 1.0
  var opacity = 0.0
  var blur = 0.0
  var mix = 0.0
  var fade = 0.0
  val p = DoubleArray(words)
  var edge = DoubleArray(words) { UNREACHED }
  val backing: Array<DoubleArray> = Array(backing.size) { DoubleArray(backing[it]) { UNREACHED } }
  var wash = 0.0
  val glow = DoubleArray(words)
  var glowR = L.Glow.radius
  val emph: List<List<Spring>> = emph.map { n -> List(n) { Spring() } }
  val wy = DoubleArray(words) { if (reduced) 0.0 else L.Word.liftEm }
  val ws = DoubleArray(words) { 1.0 }
}

class Dots(var opacity: Double = 0.0, val scale: DoubleArray = doubleArrayOf(1.0, 1.0, 1.0), val alpha: DoubleArray = DoubleArray(3))

private fun table(points: List<Pair<Double, Double>>, z: Double): Double {
  if (z <= points.first().first) return points.first().second
  for (i in 1 until points.size) {
    val (z1, v1) = points[i]
    val (z0, v0) = points[i - 1]
    if (z <= z1) return v0 + (v1 - v0) * (z - z0) / (z1 - z0)
  }
  return points.last().second
}

fun opacityAt(z: Double) = table(L.opacity, z)

fun blurAt(z: Double) = table(L.blur, z)

fun unlitMixAt(z: Double) = L.unlitMix * (1 - z / L.Column.dz).coerceIn(0.0, 1.0)

fun sweepAt(w: LyricWord, t: Double) = ((t - w.start) / max((w.end - w.start).toDouble(), L.Sweep.minWordMs)).coerceIn(0.0, 1.0)

private const val SETTLE_MS = 250.0
const val UNREACHED = -1e6

/**
 * The sweep as one soft edge along the whole line: the words end to end, the edge crossing each in
 * that word's time; a word's value is how far the edge is through it (past 1, below 0 while the
 * fades still touch it). Across a hold gap nothing ahead is lit.
 */
fun lineEdges(words: List<LyricWord>, widths: List<Float>, t: Double): DoubleArray {
  val w = DoubleArray(words.size) { max(1.0, (widths.getOrNull(it) ?: 1f).toDouble()) }
  val x = DoubleArray(words.size)
  var acc = 0.0
  for (k in words.indices) {
    x[k] = acc
    acc += w[k]
  }
  var edge = 0.0
  var next = 0
  while (next < words.size && t >= words[next].start) {
    edge = x[next] + w[next] * sweepAt(words[next], t)
    next++
  }
  var reach = next - 1
  while (reach >= 0 && reach + 1 < words.size && words[reach + 1].start - words[reach].end <= L.Sweep.holdGapMs) reach++
  val spill = reach >= next
  return DoubleArray(words.size) { k ->
    if (k >= next) {
      if (k <= reach) (edge - x[k]) / w[k] else UNREACHED
    } else {
      val along = (edge - x[k]) / w[k]
      if (k == next - 1 && t > words[k].end && !spill) max(along, 1 + (t - words[k].end) / SETTLE_MS * 4) else along
    }
  }
}

/** A lead word's own motion (§5.1): it rises over max(1 s, its length) and swells while sung. */
fun wordMotion(w: LyricWord, t: Double, emphasised: Boolean): Pair<Double, Double> {
  val dur = (w.end - w.start).toDouble()
  val u = ((t - w.start) / max(1000.0, dur)).coerceIn(0.0, 1.0)
  val pop = max(1.0, min(L.Word.popMs, dur / 2))
  val up = ((t - w.start) / pop).coerceIn(0.0, 1.0)
  val down = ((t - w.end) / L.Word.releaseMs).coerceIn(0.0, 1.0)
  val peak = if (emphasised) 1.0 else L.Word.peak
  return L.Word.liftEm * (1 - u).pow(3) to 1 + (peak - 1) * (1 - (1 - up).pow(3)) * (1 - down * down * (3 - 2 * down))
}

fun washAt(line: LyricLine, t: Double): Double {
  val x = ((t - line.start) / L.washMs).coerceIn(0.0, 1.0)
  return 1 - (1 - x).pow(4)
}

private const val SEEK_JUMP_MS = 150.0

private fun staggerMs(rank: Int) = if (rank <= 0) 0.0 else L.Stagger.baseMs * (1 - L.Stagger.decay.pow(-rank)) / (1 - 1 / L.Stagger.decay)

class FieldModel(val tl: Timeline, var boxes: List<LineBox>, private val dotsH: Double) {
  val lines = tl.lines
  private val leftAt = DoubleArray(lines.size) { Double.POSITIVE_INFINITY }
  val insts = LinkedHashMap<Int, Inst>()
  var leaving = mutableListOf<Inst>()
  val dots = Dots()
  var key: Pair<Double, Double>? = null
  private val beats = Beat()
  private var beat = BeatTerms(0.6, 0.0, 0.0, 0.0)
  private var lastT = Double.NaN
  private var lastMode = Mode.Run
  private var lastField: FieldState? = null
  private var pause = 1.0
  private var reduced = false
  private var dotsLeave = 0.0

  init {
    for (s in tl.spans) for (j in 0 until s.next) if (j != s.line && leftAt[j] == Double.POSITIVE_INFINITY) leftAt[j] = s.from
  }

  val active: Int get() = lastField?.active ?: -1

  /** New measurements (resize): everything jumps to its new place (§9.10). */
  fun relayout(b: List<LineBox>) {
    boxes = b
    lastT = Double.NaN
  }

  fun update(t: Double, dt: Double, playing: Boolean, mode: Mode, W: Double, H: Double, features: Features, reduced: Boolean) {
    val first = lastT.isNaN()
    val jumped = !first && mode != Mode.Scrub && (t < lastT - 1 || abs(t - (lastT + if (playing) dt else 0.0)) > SEEK_JUMP_MS)
    val seek = jumped || (lastMode == Mode.Scrub && mode != Mode.Scrub)
    this.reduced = reduced
    val direct = mode != Mode.Run || first || reduced
    lastT = t
    lastMode = mode

    val fs = fieldAt(tl, t)
    val prev = lastField
    lastField = fs
    val handover = prev != null && (prev.active != fs.active || prev.next != fs.next)
    val slowHandover = handover && (prev!!.active < 0 || fs.active < 0)
    val n = lines.size

    val activeLine = if (fs.active >= 0) lines[fs.active] else null
    beat = beats.update(features, dt, if (seek) 0.0 else t - fs.from, vocalAt(activeLine?.words, activeLine != null, features.mid, t), mode, reduced)

    val pauseTarget = if (playing) 1.0 else L.Glow.paused
    val pauseRate = (1 - L.Glow.paused) / (if (playing) L.Glow.resumeMs else L.Glow.pauseMs)
    pause = if (mode == Mode.Still) pauseTarget else if (pause < pauseTarget) min(pauseTarget, pause + pauseRate * dt) else max(pauseTarget, pause - pauseRate * dt)

    // ---- the column (§4) ----
    fun box(i: Int) = boxes[i]
    val anchorY = L.anchorY * H
    val gap = L.Column.gap * dotsH
    val h0 = if (fs.active >= 0) box(fs.active).h.toDouble() else dotsH
    val want = LinkedHashMap<Int, Triple<Role, Int, Double>>()
    if (fs.active >= 0) want[fs.active] = Triple(Role.Zone, 0, anchorY)
    var edge = anchorY + h0 / 2
    var j = fs.next
    while (j < n && edge < (1 + L.Column.margin) * H) {
      val h = box(j).h
      want[j] = Triple(Role.Zone, j - fs.next + 1, edge + gap + h / 2)
      edge += gap + h
      j++
    }
    edge = anchorY - h0 / 2
    j = min(fs.next, n) - 1
    var rank = -1
    while (j >= 0 && edge > -L.Column.margin * H) {
      if (j != fs.active) {
        val h = box(j).h
        want[j] = Triple(Role.Past, rank--, edge - gap - h / 2)
        edge -= gap + h
      }
      j--
    }

    val gone = insts.keys.filter { it !in want }
    for (i in gone) {
      val inst = insts.remove(i)!!
      if (mode == Mode.Still) continue
      inst.leaving = Leaving(if (seek) L.Build.seekOutMs else L.Decay.dropMs, 0.0, inst.opacity)
      leaving += inst
    }

    fun params(i: Int): SpringParams {
      if (seek || slowHandover) return Springs.slow
      val a = if (fs.active >= 0) fs.active else i
      val g = (lines.getOrNull(a + 1)?.start?.toDouble() ?: Double.POSITIVE_INFINITY) - lines[a].start
      return lineNormal(g)
    }

    for ((i, w) in want) {
      val (role, rk, wy) = w
      var inst = insts[i]
      val tx = anchorX(box(i), W)
      val tz = min(1.0, abs(rk) * L.Column.dz)
      if (inst == null) {
        // A line entering the column joins its neighbour where it is, delay and spring included.
        val nb = if (direct) null else insts[if (role == Role.Past) i + 1 else i - 1]
        val off = if (nb != null) nb.y.x - (want[nb.i]?.third ?: nb.y.x) else 0.0
        inst = create(i, role, rk, tx, wy + off, tz, mode == Mode.Still)
        if (nb != null) {
          inst.y.v = nb.y.v
          inst.delay = nb.delay
          inst.params = nb.params
        }
        insts[i] = inst
      } else if (inst.rank != rk || inst.role != role) {
        inst.params = params(i)
        inst.delay = if (seek || direct) 0.0 else staggerMs(rk)
        inst.role = role
        inst.rank = rk
      } else if (seek) {
        inst.params = Springs.slow
        inst.delay = 0.0
      }
      inst.delay = max(0.0, inst.delay - dt)
      if (inst.delay == 0.0) {
        inst.tx = tx
        inst.ty = wy
        inst.tz = tz
      }
      if (direct) {
        snap(inst.x, inst.tx)
        snap(inst.y, inst.ty)
        snap(inst.z, inst.tz)
      } else {
        step(inst.x, inst.tx, inst.params, dt)
        step(inst.y, inst.ty, inst.params, dt)
        step(inst.z, inst.tz, inst.params, dt)
      }
      inst.age += if (mode == Mode.Still) L.Build.fadeInMs else dt
      val shown = inst.opacity
      style(inst, role, t)
      if (reduced && mode == Mode.Run) inst.opacity = shown + (inst.opacity - shown).coerceIn(-dt / L.Reduced.crossfadeMs, dt / L.Reduced.crossfadeMs)
      words(inst, t, dt, mode, seek || direct)
    }

    for (inst in leaving) {
      val l = inst.leaving!!
      l.age += dt
      inst.opacity = l.from * max(0.0, 1 - l.age / l.ms)
    }
    leaving = leaving.filter { (it.leaving?.age ?: 0.0) < (it.leaving?.ms ?: 0.0) }.toMutableList()

    updateDots(fs, t, dt, mode == Mode.Still)
    updateKey(fs, W, H)
  }

  /** The column's start edge, or its end for the second voice of a duet (§4.4). */
  private fun anchorX(b: LineBox, W: Double): Double {
    val inset = (1 - L.maxWidth) / 2 * W
    return if (b.side == Side.Right) W - inset - b.w / 2 else inset + b.w / 2
  }

  private fun create(i: Int, role: Role, rank: Int, x: Double, y: Double, z: Double, still: Boolean): Inst {
    val words = lines[i].words ?: emptyList()
    val em = boxes.getOrNull(i)?.words ?: emptyList()
    return Inst(
      i, role, rank, Spring(x), Spring(y), Spring(z), Springs.slow, 0.0, x, y, z,
      if (still) L.Build.fadeInMs else 0.0,
      words.size,
      (lines[i].background ?: emptyList()).map { it.words?.size ?: 0 },
      words.indices.map { k -> if (em.getOrNull(k)?.emphasis != null) em[k].graphemes.size else 0 },
      reduced,
    )
  }

  private fun style(inst: Inst, role: Role, t: Double) {
    val z = inst.z.x
    val born = if (reduced) 1.0 else (inst.age / L.Build.fadeInMs).coerceIn(0.0, 1.0)
    inst.opacity = opacityAt(z) * born
    inst.blur = blurAt(z)
    inst.scale = if (inst.rank == 0) 1 + beat.pulse else 1.0
    inst.mix = unlitMixAt(z)
    inst.fade = if (role == Role.Past) 1 - exp(-max(0.0, t - leftAt[inst.i]) / L.Decay.tauMs) else 0.0
  }

  private fun words(inst: Inst, t: Double, dt: Double, mode: Mode, settle: Boolean) {
    val line = lines[inst.i]
    val words = line.words ?: emptyList()
    for (k in words.indices) inst.p[k] = sweepAt(words[k], t)
    val boxes = this.boxes.getOrNull(inst.i)?.words ?: emptyList()
    inst.edge = lineEdges(words, boxes.map { it.rect.w }, t)
    (line.background ?: emptyList()).forEachIndexed { b, bl -> inst.backing[b] = lineEdges(bl.words ?: emptyList(), emptyList(), t) }
    inst.wash = if (words.isEmpty()) washAt(line, t) else 0.0
    for (k in words.indices) {
      val (y, s) = if (reduced) 0.0 to 1.0 else wordMotion(words[k], t, boxes.getOrNull(k)?.emphasis != null)
      inst.wy[k] = y
      inst.ws[k] = s
    }

    // Glow (§5.2): the sweeping word of the line being sung (rank 0, or a line sweeping at +1).
    val sweeping = words.indexOfFirst { t >= it.start && t < it.end }
    val lit = inst.rank == 0 || (inst.rank == 1 && sweeping >= 0)
    val slew = L.Glow.slewPerS / 1000 * dt
    val (alpha, radius) = glowFor(beat.sustain, beat.glowAdd)
    inst.glowR = radius
    val target = if (lit && sweeping >= 0) alpha * pause else 0.0
    val before = inst.glow.copyOf()
    fun end(a: Double, next: Double) = if (next < 0.005 && a <= slew) 0.0 else next
    var fading = 0
    for (k in words.indices) {
      val a = before[k]
      if ((k == sweeping && target > 0) || a == 0.0) continue
      val tau = if (words[k].end - words[k].start < 150) L.Glow.decayFastMs else L.Glow.decayMs
      val next = if (mode == Mode.Still) 0.0 else max(a * exp(-dt / tau), a - slew)
      val g = end(a, next)
      inst.glow[k] = g
      if (g > 0) fading++
    }
    // At most two words glow (§5.2): the older fades at the fastest permitted rate.
    val own = if (sweeping >= 0 && before[sweeping] > 0) 1 else 0
    if (fading >= 2 || fading + own > 2) {
      val oldest = inst.glow.indices.firstOrNull { inst.glow[it] > 0 && it != sweeping }
      if (oldest != null) inst.glow[oldest] = end(before[oldest], max(0.0, before[oldest] - slew))
    }
    if (sweeping >= 0) {
      val a = before[sweeping]
      val room = inst.glow.indices.count { inst.glow[it] > 0 && it != sweeping } < 2
      inst.glow[sweeping] =
        when {
          mode == Mode.Still -> target
          a < target -> if (room) min(target, a + min(L.Glow.alpha / L.Glow.riseMs * dt, slew)) else a
          else -> max(target, a - slew)
        }
    }

    // Emphasis (§5.5): graphemes lift and swell in sequence from 400 ms before the word.
    for (k in words.indices) {
      val e = boxes.getOrNull(k)?.emphasis ?: continue
      val gs = inst.emph.getOrNull(k) ?: continue
      val w = words[k]
      gs.forEachIndexed { g, s ->
        val on = mode != Mode.Scrub && !reduced && t >= w.start - L.Emphasis.anticipateMs + g * e.stepMs && t < w.end - L.Emphasis.releaseMs
        if (settle) snap(s, if (on) 1.0 else 0.0) else step(s, if (on) 1.0 else 0.0, Springs.lift, dt)
      }
    }
  }

  private fun updateDots(fs: FieldState, t: Double, dt: Double, still: Boolean) {
    if (fs.dots) {
      val since = t - fs.from
      dots.opacity = (since / L.Interlude.enterMs).coerceIn(0.0, 1.0)
      dotsLeave = dots.opacity
      for (k in 0..2) {
        val ph = (since - k * L.Interlude.dotStepMs) / L.Interlude.cycleMs
        val b = 0.5 - 0.5 * cos(2 * PI * ph)
        dots.scale[k] = if (reduced) 1.0 else 0.4 + 0.85 * b
        dots.alpha[k] = if (reduced) L.Reduced.dotsAlpha else 0.2 + 0.7 * b
      }
    } else {
      dotsLeave = if (still) 0.0 else max(0.0, dotsLeave - dt / L.Interlude.fadeMs)
      dots.opacity = dotsLeave
    }
  }

  private fun updateKey(fs: FieldState, W: Double, H: Double) {
    val a = if (fs.active >= 0) insts[fs.active] else null
    if (a == null) {
      key = null
      return
    }
    val line = lines[a.i]
    val b = boxes[a.i]
    val k = a.p.indexOfFirst { it < 1 }
    val r = b.words.getOrNull(if (k < 0) (line.words?.size ?: 1) - 1 else k)?.rect
    val ox = if (r != null) (r.x + r.w / 2 - b.w / 2) * a.scale else 0.0
    val oy = if (r != null) (r.y + r.h / 2 - b.h / 2) * a.scale else 0.0
    key = (a.x.x + ox) / W to (a.y.x + oy) / H
  }
}
