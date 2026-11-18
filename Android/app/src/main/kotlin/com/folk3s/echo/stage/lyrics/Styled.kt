package com.folk3s.echo.stage.lyrics

import android.os.Build
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folk3s.echo.LyricStyle
import com.folk3s.echo.api.LyricWord
import com.folk3s.echo.api.LyricsDoc
import com.folk3s.echo.echo
import com.folk3s.echo.ui.look
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// The lyric styles (v0.3, 2026-11-17; ECHO classic stays LyricsField.kt): Apple Music style,
// Spicy Lyrics style, Cinema, Colour block, Karaoke (one column of lines, each drawn word by word
// from the clock) and Kinetic (one line at a time). The clock is read while drawing, so a frame
// redraws without recomposing; only a change of line recomposes.

/** A word with its characters in the line's text. */
data class SWord(val from: Int, val to: Int, val start: Long, val end: Long)

/** A line ready to draw: its text, timing, words, and backing vocals (smaller, under it). */
data class SLine(val text: String, val start: Long, val end: Long, val words: List<SWord>, val wordTimed: Boolean, val right: Boolean, val bg: SLine?)

/** A place in the column: a line, or the dots of a long gap before the next one. */
sealed interface Slot {
  val start: Long
  val end: Long

  data class Line(val i: Int, val line: SLine) : Slot {
    override val start get() = line.start
    override val end get() = line.end
  }

  data class Dots(override val start: Long, override val end: Long) : Slot
}

private const val GAP_MS = 5000L

private fun build(text: String, words: List<LyricWord>?, start: Long, end: Long, right: Boolean, bg: SLine?): SLine {
  if (words.isNullOrEmpty()) return SLine(text.trim(), start, end, listOf(SWord(0, text.trim().length, start, end)), false, right, bg)
  val sb = StringBuilder()
  val out = ArrayList<SWord>()
  words.forEachIndexed { i, w ->
    val t = w.text.trim()
    if (t.isEmpty()) return@forEachIndexed
    val from = sb.length
    sb.append(t)
    out += SWord(from, sb.length, w.start, max(w.end, w.start + 1))
    if (i < words.lastIndex && !w.isPartOfWord) sb.append(' ')
  }
  return SLine(sb.toString().trimEnd(), start, end, out, true, right, bg)
}

/** The doc as lines and slots (dots where the singing stops for 5 s or more). */
fun slotsOf(doc: LyricsDoc): List<Slot> {
  val src = doc.lines.filter { it.text.isNotBlank() }
  val lines =
    src.mapIndexed { i, l ->
      val end = l.end ?: l.words?.lastOrNull()?.end ?: src.getOrNull(i + 1)?.start?.minus(100) ?: (l.start + 5000)
      val bg = l.background?.firstOrNull()?.let { b -> build(b.text, b.words, b.start ?: l.start, b.end ?: end, l.oppositeAligned, null) }
      build(l.text, l.words, l.start, end, l.oppositeAligned, bg)
    }
  val slots = ArrayList<Slot>()
  if (lines.isNotEmpty() && lines[0].start > GAP_MS) slots += Slot.Dots(0, lines[0].start)
  lines.forEachIndexed { i, l ->
    slots += Slot.Line(i, l)
    val next = lines.getOrNull(i + 1)
    if (next != null && next.start - l.end >= GAP_MS) slots += Slot.Dots(l.end, next.start)
  }
  return slots
}

/** Where the song is, in lyric time, read each frame. */
@Composable
fun rememberLyricTime(offset: Long): State<Long> {
  val app = LocalContext.current.echo
  val t = remember { mutableLongStateOf(0L) }
  LaunchedEffect(offset) {
    while (true) withFrameMillis { t.longValue = app.playback.state.value.positionNow() - offset }
  }
  return t
}

/** How far a word is sung: 0 before it, 1 after it. */
private fun progress(t: Long, a: Long, b: Long): Float = if (b <= a) (if (t >= a) 1f else 0f) else ((t - a).toFloat() / (b - a)).coerceIn(0f, 1f)

/** Each style's rules. */
private data class Rules(
  val size: Float,
  val weight: Int,
  val center: Boolean,
  val anchor: Float, // where the active line sits, as a share of the height
  val blur: Boolean,
  val dim: Float, // the alpha of lines not being sung
  val stagger: Long,
  val onlyNear: Int, // hide lines further than this from the active one (0: show all)
  val sweep: Boolean, // line-timed lines fill across their duration (else light at once)
)

private fun rulesOf(s: LyricStyle) =
  when (s) {
    LyricStyle.Apple -> Rules(30f, 800, false, 0.26f, true, 0.3f, 45, 0, false)
    LyricStyle.Spicy -> Rules(31f, 900, false, 0.3f, false, 0.28f, 30, 0, false)
    LyricStyle.Cinema -> Rules(36f, 800, true, 0.42f, true, 0.4f, 35, 1, false)
    LyricStyle.ColourBlock -> Rules(26f, 800, false, 0.28f, false, 1f, 0, 0, false)
    LyricStyle.Karaoke -> Rules(28f, 800, true, 0.42f, false, 0.6f, 0, 1, true)
    else -> Rules(30f, 800, false, 0.3f, true, 0.35f, 45, 0, false)
  }

/**
 * The column styles: every line laid out once; the column glides (line by line, with a little
 * stagger) to keep the active one at the style's anchor. A drag scrolls it for a moment; a tap on a
 * line plays from there.
 */
@Composable
fun StyledLyrics(doc: LyricsDoc, style: LyricStyle, offset: Long, scale: Float, reduced: Boolean, accent: Color, bottomPad: Float, onSeek: (Long) -> Unit) {
  if (style == LyricStyle.Kinetic) return KineticLyrics(doc, offset, scale, reduced, accent)
  val rules = rulesOf(style)
  val slots = remember(doc) { slotsOf(doc) }
  val time = rememberLyricTime(offset)
  val active by remember(slots) { derivedStateOf { slots.indexOfLast { it.start <= time.value }.coerceAtLeast(0) } }
  val tops = remember(slots) { mutableStateListOf<Float>().apply { repeat(slots.size) { add(0f) } } }
  val heights = remember(slots) { mutableStateListOf<Float>().apply { repeat(slots.size) { add(0f) } } }
  val ys = remember(slots) { List(slots.size) { Animatable(0f) } }
  val manual = remember { Animatable(0f) }
  val scope = rememberCoroutineScope()
  val density = LocalDensity.current
  val font = look.font
  BoxWithConstraints(
    Modifier.fillMaxSize().clipToBounds().draggable(
      rememberDraggableState { d -> scope.launch { manual.snapTo(manual.value + d) } },
      Orientation.Vertical,
      onDragStopped = {
        delay(2500)
        manual.animateTo(0f, spring(dampingRatio = 0.9f, stiffness = 120f))
      },
    ),
  ) {
    val h = constraints.maxHeight.toFloat() - bottomPad
    val anchor = h * rules.anchor
    // Glide: each slot to the column's new offset, those below the active one a little later.
    LaunchedEffect(active, tops.toList(), anchor) {
      val a = active
      val target = anchor - tops[a] - (if (rules.center) heights[a] / 2 else 0f)
      for (i in slots.indices) {
        launch {
          if (reduced) return@launch ys[i].snapTo(target)
          val wait = if (i > a) min(i - a, 8) * rules.stagger else 0L
          delay(wait)
          ys[i].animateTo(target, spring(dampingRatio = 0.85f, stiffness = 140f))
        }
      }
    }
    val text =
      TextStyle(
        fontFamily = font,
        fontWeight = FontWeight(rules.weight),
        fontSize = (rules.size * scale).sp,
        lineHeight = (rules.size * 1.18f * scale).sp,
        letterSpacing = (-0.3).sp,
        textAlign = if (rules.center) TextAlign.Center else TextAlign.Start,
      )
    Column(Modifier.fillMaxWidth().wrapContentHeight(Alignment.Top, unbounded = true).padding(horizontal = 28.dp)) {
      for ((i, slot) in slots.withIndex()) {
        key(i) {
          val dist = i - active
          val near = rules.onlyNear == 0 || dist in (if (style == LyricStyle.Karaoke) 0..1 else -rules.onlyNear..rules.onlyNear)
          val alpha by animateFloatAsState(if (near) 1f else 0f, tween(260), label = "a")
          // Apple's depth: a little blur per line away from the one being sung, never smearing.
          val blurDp by animateFloatAsState(if (rules.blur && dist != 0) min(abs(dist) * 0.8f, 3f) else 0f, tween(500), label = "b")
          val scale by animateFloatAsState(if (dist == 0 || style == LyricStyle.ColourBlock) 1f else 0.96f, spring(dampingRatio = 0.8f, stiffness = 200f), label = "s")
          Box(
            Modifier.fillMaxWidth()
              .onGloballyPositioned {
                tops[i] = it.positionInParent().y
                heights[i] = it.size.height.toFloat()
              }
              .graphicsLayer {
                translationY = ys[i].value + manual.value
                this.alpha = alpha
                scaleX = scale
                scaleY = scale
                transformOrigin = TransformOrigin(if (rules.center) 0.5f else if (slot is Slot.Line && slot.line.right) 1f else 0f, 0.5f)
              }
              .then(if (blurDp > 0.05f && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Modifier.blur(blurDp.dp) else Modifier)
              .pointerInput(slot) { detectTapGestures { onSeek(slot.start) } }
              .padding(vertical = if (style == LyricStyle.ColourBlock) 7.dp else 12.dp),
          ) {
            when (slot) {
              is Slot.Dots -> Dots(slot, time, rules.center, active == i, with(density) { (rules.size * scale * 0.5f).sp.toPx() })
              is Slot.Line -> {
                Column {
                  LineCanvas(slot.line, style, rules, text, time, dist == 0, dist < 0, accent)
                  slot.line.bg?.let { bg ->
                    LineCanvas(bg, style, rules, text.copy(fontSize = text.fontSize * 0.62f, lineHeight = text.lineHeight * 0.62f, fontWeight = FontWeight(700)), time, dist == 0, dist < 0, accent)
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

/** One line, drawn from the clock: dim, lit, or word by word with the style's touch. */
@Composable
private fun LineCanvas(line: SLine, style: LyricStyle, rules: Rules, text: TextStyle, time: State<Long>, active: Boolean, past: Boolean, accent: Color) {
  val tm = rememberTextMeasurer()
  val density = LocalDensity.current
  val align = if (line.right && !rules.center) TextAlign.End else text.textAlign
  BoxWithConstraints(Modifier.fillMaxWidth()) {
    val w = constraints.maxWidth
    val layout = remember(line.text, text, w, align) { tm.measure(AnnotatedString(line.text), text.copy(textAlign = align), constraints = Constraints(maxWidth = w)) }
    // On the line being sung, each word is its own small layout set on the line's baseline at its
    // place: a word can rise, swell and glow without clipping, and never doubles a neighbour.
    val words =
      remember(layout, active) {
        if (!active || !line.wordTimed) null
        else
          line.words.map { wd ->
            val sub = tm.measure(AnnotatedString(line.text.substring(wd.from, wd.to)), text.copy(textAlign = TextAlign.Start), softWrap = false)
            val row = layout.getLineForOffset(wd.from)
            Placed(sub, Offset(layout.getHorizontalPosition(wd.from, true).let { if (layout.getParagraphDirection(wd.from) == androidx.compose.ui.text.style.ResolvedTextDirection.Rtl) it - sub.size.width else it }, layout.getLineBaseline(row) - sub.firstBaseline))
          }
      }
    val pad = with(density) { 10.dp.toPx() }
    val em = with(density) { text.fontSize.toPx() }
    val heightDp = with(density) { (layout.size.height + 2 * pad).toDp() }
    val white = Color.White
    val dim = white.copy(alpha = rules.dim)
    // The unsung part of the line being sung: a little brighter than the lines around it.
    val ahead = white.copy(alpha = min(1f, rules.dim + 0.12f))
    Canvas(Modifier.fillMaxWidth().height(heightDp)) {
      val t = time.value
      translate(0f, pad) {
        when {
          style == LyricStyle.ColourBlock -> drawText(layout, color = if (active || past) white else Color.Black.copy(alpha = 0.62f), shadow = Shadow.None)
          !active -> drawText(layout, color = dim, shadow = Shadow.None)
          words == null -> {
            // A line without word timing: it lights in a quarter of a second (Karaoke sweeps it).
            val whole = Rect(0f, 0f, layout.size.width.toFloat(), layout.size.height.toFloat())
            if (rules.sweep) drawText(layout, brush = sweep(whole, progress(t, line.start, line.end), accent, white, em * 0.3f), shadow = Shadow.None)
            else drawText(layout, color = lerp(ahead, white, progress(t, line.start, line.start + 250)), shadow = Shadow.None)
          }
          else ->
            line.words.forEachIndexed { k, word ->
              val (sub, at) = words[k]
              val r = Rect(0f, 0f, sub.size.width.toFloat(), sub.size.height.toFloat())
              val p = progress(t, word.start, word.end)
              translate(at.x, at.y) {
                when (style) {
                  LyricStyle.Karaoke -> drawText(sub, brush = sweep(r, p, accent, white, em * 0.12f), shadow = Shadow.None)
                  LyricStyle.Spicy -> {
                    val sung = p > 0f
                    val swell = if (t in word.start..word.end) sin(PI * p).toFloat() else 0f
                    val glow = if (!sung) 0f else if (t > word.end) max(0.2f, 1f - (t - word.end) / 900f) else 1f
                    withTransform({
                      translate(0f, -em * 0.08f * easeOut(min(1f, (t - word.start) / 220f)) * (if (sung) 1f else 0f))
                      scale(1f + 0.07f * swell, 1f + 0.07f * swell, r.center)
                    }) {
                      if (!sung) drawText(sub, color = ahead, shadow = Shadow.None)
                      else drawText(sub, brush = sweep(r, p, white, ahead, em * 0.25f), shadow = Shadow(white.copy(alpha = 0.7f * glow), Offset.Zero, em * 0.6f * glow))
                    }
                  }
                  else -> {
                    // Apple Music style and Cinema: a soft edge sweeps each word, which rises a touch
                    // as it's sung; a held word (about a second or more) swells and glows while held.
                    val emph = if (word.end - word.start >= 900 && t in word.start..word.end) sin(PI * p).toFloat() else 0f
                    withTransform({
                      translate(0f, -em * 0.05f * easeOut(p))
                      if (emph > 0f) scale(1f + 0.04f * emph, 1f + 0.04f * emph, r.center)
                    }) {
                      drawText(sub, brush = sweep(r, p, white, ahead, em * 0.4f), shadow = if (emph > 0f) Shadow(white.copy(alpha = 0.55f * emph), Offset.Zero, em * 0.5f * emph) else Shadow.None)
                    }
                  }
                }
              }
            }
        }
      }
    }
  }
}

/** A word's own layout and where it sits in its line. */
private data class Placed(val layout: TextLayoutResult, val at: Offset)

private fun easeOut(x: Float): Float = 1f - (1f - x.coerceIn(0f, 1f)).let { it * it * it }

/**
 * Lit up to the edge at [p] across the word's glyphs, unlit after, the edge [soft] px wide: it
 * enters before the first letter and leaves after the last, so a word ends wholly lit.
 */
private fun sweep(r: Rect, p: Float, lit: Color, unlit: Color, soft: Float): Brush {
  if (p <= 0f) return Brush.horizontalGradient(listOf(unlit, unlit))
  if (p >= 1f) return Brush.horizontalGradient(listOf(lit, lit))
  val e = r.left - soft / 2 + p * (r.width + soft)
  return Brush.horizontalGradient(0f to lit, 1f to unlit, startX = e - soft / 2, endX = e + soft / 2, tileMode = TileMode.Clamp)
}

/** A long gap's three dots: they breathe, and fill one by one as the gap runs out. */
@Composable
private fun Dots(slot: Slot.Dots, time: State<Long>, center: Boolean, active: Boolean, size: Float) {
  val shown by animateFloatAsState(if (active) 1f else 0f, spring(dampingRatio = 0.8f, stiffness = 300f), label = "dots")
  val d = with(LocalDensity.current) { (size * 1.6f * shown).toDp() }
  Canvas(Modifier.fillMaxWidth().height(d)) {
    if (shown < 0.02f) return@Canvas
    val t = time.value
    val p = progress(t, slot.start, slot.end - 300)
    val breathe = 1f + 0.12f * sin((t % 2400) / 2400f * 2 * PI).toFloat()
    val r = size * 0.32f * shown * breathe
    val gap = size * 0.95f
    val x0 = if (center) this.size.width / 2 - gap else r
    for (k in 0..2) {
      val lit = ((p * 3) - k).coerceIn(0f, 1f)
      drawCircle(Color.White.copy(alpha = 0.3f + 0.7f * lit), r, Offset(x0 + k * gap, this.size.height / 2))
    }
  }
}

// ---- Kinetic ----

/** One line at a time, huge: each word pops in with a spring as it's sung; the line before, small above. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun KineticLyrics(doc: LyricsDoc, offset: Long, scale: Float, reduced: Boolean, accent: Color) {
  val slots = remember(doc) { slotsOf(doc).filterIsInstance<Slot.Line>() }
  val time = rememberLyricTime(offset)
  val active by remember(slots) { derivedStateOf { slots.indexOfLast { it.start <= time.value } } }
  val font = look.font
  Box(Modifier.fillMaxSize().padding(horizontal = 28.dp), contentAlignment = Alignment.CenterStart) {
    AnimatedContent(
      active,
      transitionSpec = {
        if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
        else (slideInVertically(spring(dampingRatio = 0.75f, stiffness = 260f)) { it / 3 } + fadeIn(tween(200))) togetherWith (slideOutVertically(tween(220)) { -it / 4 } + fadeOut(tween(160)))
      },
      label = "kinetic",
    ) { a ->
      Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        slots.getOrNull(a - 1)?.let { BasicText(it.line.text, style = TextStyle(fontFamily = font, fontWeight = FontWeight(600), fontSize = 17.sp, color = Color.White.copy(alpha = 0.5f))) }
        val line = slots.getOrNull(a)?.line
        if (line == null) BasicText("♪", style = TextStyle(fontFamily = font, fontWeight = FontWeight(800), fontSize = 52.sp, color = Color.White.copy(alpha = 0.6f)))
        else
          FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            for (w in line.words) {
              val word = line.text.substring(w.from, w.to)
              val start = if (line.wordTimed) w.start else line.start
              val end = if (line.wordTimed) w.end else line.end
              BasicText(
                word,
                style = TextStyle(fontFamily = font, fontWeight = FontWeight(900), fontSize = (50 * scale).sp, lineHeight = (54 * scale).sp, letterSpacing = (-1).sp),
                color = { val t = time.value; if (line.wordTimed && t in start..end) accent else if (t >= start) Color.White else Color.White.copy(alpha = 0.22f) },
                modifier = Modifier.graphicsLayer {
                  val x = (time.value - start).toFloat()
                  // A pop: from 70% with a quick overshoot that settles in about half a second.
                  val k = if (reduced || x < 0) 1f else 1f + 0.18f * exp(-x / 140f) * sin(x / 55f) - 0.3f * exp(-x / 60f)
                  scaleX = k
                  scaleY = k
                  rotationZ = if (reduced || x < 0) 0f else -3f * exp(-x / 160f)
                },
              )
            }
          }
      }
    }
  }
}
