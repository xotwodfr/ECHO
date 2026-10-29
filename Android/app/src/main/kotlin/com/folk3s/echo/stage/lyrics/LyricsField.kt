package com.folk3s.echo.stage.lyrics

import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.api.Linear
import com.folk3s.echo.api.linearToOklab
import com.folk3s.echo.api.oklabToLinear
import com.folk3s.echo.api.toArgb
import com.folk3s.echo.echo
import com.folk3s.echo.stage.Features
import com.folk3s.echo.stage.StagePalette
import com.folk3s.echo.stage.StageView
import com.folk3s.echo.stage.stagePalette
import com.folk3s.echo.ui.Chamber
import kotlin.math.max
import kotlin.math.min

// The lyric field (field.ts and stage.css on Android; LYRICS_EXPERIENCE.md §3–§9): each line is a
// layer whose position, scale, opacity and depth blur the model sets every frame; its words are
// drawn one by one with the sweep (lit → the highlight's edge → unlit), their rise and swell, the
// glow, and held words grapheme by grapheme. Frames redraw; nothing recomposes per frame.

private fun mix(a: Linear, b: Linear, k: Double): Color {
  val p = linearToOklab(a.r.toDouble(), a.g.toDouble(), a.b.toDouble())
  val q = linearToOklab(b.r.toDouble(), b.g.toDouble(), b.b.toDouble())
  val r = oklabToLinear(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k)
  return Color(Linear(r[0].toFloat().coerceIn(0f, 1f), r[1].toFloat().coerceIn(0f, 1f), r[2].toFloat().coerceIn(0f, 1f)).toArgb())
}

private val TEXT = Linear(0.8878f, 0.8796f, 0.8550f) // --text #F2F1EE, linear

/** A word's inks (stage.css): unlit toward the room by `m`, lit toward ink by `f` (§5.1, §7). */
private class Inks(p: StagePalette, inst: Inst, right: Boolean) {
  private val litBase: Linear = blend(TEXT, p.highlight, 0.18).let { if (right) blend(it, p.accent, 0.25) else it }
  val unlit = mix(p.ink, p.room, inst.mix)
  val lit = mix(litBase, p.ink, inst.fade)
  val edge = Color(p.highlight.toArgb())
  val glow = Color(p.glow.toArgb())

  private fun blend(a: Linear, b: Linear, k: Double): Linear {
    val c = mix(a, b, k)
    fun lin(v: Float) = com.folk3s.echo.api.srgbToLinear(v.toDouble()).toFloat()
    return Linear(lin(c.red), lin(c.green), lin(c.blue))
  }
}

/** The sweep (§5.1): lit up to 0.6 em behind the edge, the highlight at it, unlit 0.35 em ahead. */
private fun sweep(p: Double, w: Float, em: Float, inks: Inks, rtl: Boolean): Brush {
  val e = (p * w).toFloat()
  val a = e - 0.6f * em
  val b = e + 0.35f * em
  val k = (e - a) / (b - a)
  return if (!rtl) Brush.horizontalGradient(0f to inks.lit, k to inks.edge, 1f to inks.unlit, startX = a, endX = b, tileMode = TileMode.Clamp)
  else Brush.horizontalGradient(0f to inks.lit, k to inks.edge, 1f to inks.unlit, startX = w - a, endX = w - b, tileMode = TileMode.Clamp)
}

private fun brushAt(p: Double, w: Float, em: Float, inks: Inks, rtl: Boolean): Brush {
  val ahead = L.Sweep.edgeAhead * em / max(1f, w)
  val behind = L.Sweep.edgeBehind * em / max(1f, w)
  return when {
    p <= -ahead -> SolidColor(inks.unlit)
    p >= 1 + behind -> SolidColor(inks.lit)
    else -> sweep(p, w, em, inks, rtl)
  }
}

@Composable
fun LyricsField(stage: StageView?, dock: Float) {
  val app = LocalContext.current.echo
  val ls by app.lyrics.state.collectAsStateWithLifecycle()
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  val palette = stagePalette()
  val doc = ls.doc?.takeIf { it.sync != "none" } ?: return
  val density = LocalDensity.current
  val resolver = LocalFontFamilyResolver.current
  val dir = LocalLayoutDirection.current
  // Sizes are px throughout: a measurer at 1 px per sp.
  val measurer = remember(resolver) { TextMeasurer(resolver, Density(1f, 1f), dir) }
  BoxWithConstraints(Modifier.fillMaxSize()) {
    val stageW = constraints.maxWidth.toFloat()
    val stageH = constraints.maxHeight.toFloat()
    val W = stageW
    val H = max(1f, stageH - dock)
    // --ly-active: clamp(32px, min(6.2vh, 4.6vw), 88px), times the lyric size setting (§4.3).
    val fontDp = min(stageH / density.density * 0.062f, stageW / density.density * 0.046f).coerceIn(32f, 88f) * prefs.lyricScale
    val fontPx = fontDp * density.density
    val tl = remember(doc) { buildTimeline(doc) }
    val layout = remember(tl, W, fontPx) { measureDoc(measurer, doc, tl.lines, W, fontPx) }
    val model = remember(layout) { FieldModel(tl, layout.lines.map { it.box }, (fontPx * LINE_HEIGHT).toDouble()) }
    val reduced = app.prefs.reducedMotion(prefs)
    val offset by rememberUpdatedState(ls.offsetMs + prefs.lyricOffsetMs)
    val frame = remember { mutableLongStateOf(0L) }
    var members by remember(model) { mutableStateOf(emptyList<Inst>()) }
    LaunchedEffect(model, reduced) {
      var last = 0L
      while (true) {
        withFrameNanos { ns ->
          val dt = if (last == 0L) 0.0 else ((ns - last) / 1e6).coerceIn(0.0, 100.0)
          last = ns
          val p = app.playback.state.value
          model.update((p.positionNow() - offset).toDouble(), dt, p.playing, Mode.Run, W.toDouble(), H.toDouble(), stage?.features ?: Features.SILENT, reduced)
          val now = model.insts.values + model.leaving
          if (now.size != members.size || now.indices.any { now[it] !== members[it] }) members = now
          model.key?.let { (x, y) ->
            stage?.keyX = x.toFloat()
            stage?.keyY = (y * H / stageH).toFloat()
          }
          frame.longValue = ns
        }
      }
    }
    // The column fades out under the top chrome and just above the dock (§3.2).
    val dockK = dock / stageH
    val mask = Brush.verticalGradient(0.04f to Color.Transparent, 0.18f to Color.Black, (1 - dockK - 0.12f) to Color.Black, (1 - dockK) to Color.Transparent)
    Box(Modifier.fillMaxSize().graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }.drawWithContent {
      drawContent()
      drawRect(mask, blendMode = BlendMode.DstIn)
    }) {
      // Spotify's: a tap on a line plays from it.
      val playFrom = { i: Int ->
        app.playback.seek(tl.lines[i].start.toLong() + offset)
        if (!app.playback.state.value.playing) app.playback.toggle()
      }
      for (inst in members) key(inst) { Line(inst, layout.lines[inst.i], frame, palette, density.density, reduced) { playFrom(inst.i) } }
      Dots(model, frame, palette, fontPx, W, H)
    }
  }
}

@Composable
private fun Line(inst: Inst, lay: LineLayout, frame: State<Long>, palette: StagePalette, dp: Float, reduced: Boolean, onTap: () -> Unit) {
  val pad = lay.em * 0.5f
  val w = lay.box.w + 2 * pad
  val h = lay.box.h + 2 * pad
  val right = lay.box.side == Side.Right
  val px = with(LocalDensity.current) { Pair(w.toDp(), h.toDp()) }
  // Lines are blurred by distance where the platform blurs a layer (API 31; §13's tiers: T0/T1).
  val blurs = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
  Canvas(
    Modifier.size(px.first, px.second).graphicsLayer {
      frame.value
      translationX = (inst.x.x - lay.box.w / 2 - pad).toFloat()
      translationY = (inst.y.x - lay.box.h / 2 - pad).toFloat()
      scaleX = inst.scale.toFloat()
      scaleY = inst.scale.toFloat()
      // Lines start at the column's edge and scale from it (stage.css .ly-line).
      transformOrigin = TransformOrigin(if (right || lay.rtl) (w - pad) / w else pad / w, 0.5f)
      alpha = inst.opacity.toFloat()
      val b = inst.blur * dp
      renderEffect = if (blurs && b > 0.05) BlurEffect(b.toFloat(), b.toFloat(), TileMode.Decal) else null
    }.pointerInput(Unit) { detectTapGestures { onTap() } },
  ) {
    frame.value
    val inks = Inks(palette, inst, right)
    translate(pad, pad) {
      if (lay.wash) lay.words.firstOrNull()?.let { word(it, inst.wash, 0.0, 1.0, 0.0, 0.0, lay, inks) }
      else
        lay.words.forEachIndexed { k, d ->
          val g = inst.glow.getOrElse(k) { 0.0 }
          val emph = inst.emph.getOrNull(k)
          if (d.graphemes.isNotEmpty() && emph != null && emph.isNotEmpty()) graphemesOf(d, inst.edge[k], emph, lay, inks, g, inst.glowR, lay.box.words.getOrNull(k)?.emphasis)
          else word(d, inst.edge[k], inst.wy[k], inst.ws[k], g, inst.glowR, lay, inks)
        }
      // Backing vocals under their lead, at 0.55 of its opacity (§5.6).
      lay.backing.forEachIndexed { j, row ->
        row.forEachIndexed { k, d ->
          val p = inst.backing.getOrNull(j)?.getOrNull(k) ?: if (lay.wash) inst.wash else UNREACHED
          drawText(d.text, brushAt(p, d.w, lay.em * BG_SIZE, inks, lay.rtl), Offset(d.x, d.y), alpha = 0.55f)
        }
      }
    }
  }
}

private fun DrawScope.word(d: WordDraw, p: Double, wy: Double, ws: Double, glow: Double, glowR: Double, lay: LineLayout, inks: Inks) {
  translate(d.x, d.y + (wy * lay.em).toFloat()) {
    scale(ws.toFloat(), ws.toFloat(), Offset(d.w / 2, d.h * 0.75f)) {
      val shadow = if (glow > 0) Shadow(inks.glow.copy(alpha = glow.toFloat()), Offset.Zero, (glowR * lay.em).toFloat()) else null
      drawText(d.text, brushAt(p, d.w, lay.em, inks, lay.rtl), shadow = shadow)
    }
  }
}

/** A held word, grapheme by grapheme (§5.5): each lifts, swells and spreads from the middle. */
private fun DrawScope.graphemesOf(d: WordDraw, p: Double, emph: List<Spring>, lay: LineLayout, inks: Inks, glow: Double, glowR: Double, e: Emphasis?) {
  val mid = (d.graphemes.size - 1) / 2.0
  val side = if (lay.rtl) -1 else 1
  d.graphemes.forEachIndexed { i, g ->
    val v = emph.getOrNull(i)?.x ?: 0.0
    val dx = ((e?.spread ?: 0.0) * v * (i - mid) * side * lay.em).toFloat()
    val dy = (-(e?.lift ?: 0.0) * v * lay.em).toFloat()
    val s = (1 + (e?.swell ?: 0.0) * v).toFloat()
    val gp = (p * d.w - g.x) / max(1f, g.w)
    translate(d.x + g.x + dx, d.y + dy) {
      scale(s, s, Offset(g.w / 2, g.h * 0.8f)) {
        val shadow = if (glow > 0) Shadow(inks.glow.copy(alpha = glow.toFloat()), Offset.Zero, (glowR * lay.em).toFloat()) else null
        drawText(g.text, brushAt(gp, g.w, lay.em, inks, lay.rtl), shadow = shadow)
      }
    }
  }
}

/** Interlude dots at the anchor, where the column starts (§9.8). */
@Composable
private fun Dots(model: FieldModel, frame: State<Long>, palette: StagePalette, fontPx: Float, W: Float, H: Float) {
  Canvas(Modifier.fillMaxSize()) {
    frame.value
    val d = model.dots
    if (d.opacity <= 0) return@Canvas
    val r = (L.Interlude.dotEm * fontPx / 2).toFloat()
    val ink = Color(palette.ink.toArgb())
    for (k in 0..2) {
      val c = Offset(W * 0.18f + r + k * r * 4, H * L.anchorY.toFloat())
      drawCircle(ink.copy(alpha = (d.alpha[k] * d.opacity).toFloat()), r * d.scale[k].toFloat(), c)
    }
  }
}
