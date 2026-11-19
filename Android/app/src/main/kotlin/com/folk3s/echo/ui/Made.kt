package com.folk3s.echo.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.text.drawText
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.folk3s.echo.playback.AudioTap
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

// The made themes' own pieces (v0.6): Retro hi-fi's spinning record and tonearm, VU meters and
// knob; Paper's taped-down polaroid and origami play button.

// ---- Retro hi-fi ----

/** The cover as the label of a record turning at 33⅓ while playing, under a tonearm that sets down on it. */
@Composable
fun Vinyl(cover: String?, title: String, playing: Boolean, still: Boolean, modifier: Modifier = Modifier) {
  // 33⅓ rpm: a turn every 1.8 s, from wherever it stopped.
  var angle by remember { mutableFloatStateOf(0f) }
  LaunchedEffect(playing, still) {
    if (!playing || still) return@LaunchedEffect
    var last = 0L
    while (true)
      withFrameMillis { t ->
        if (last != 0L) angle = (angle + (t - last) * 360f / 1800f) % 360f
        last = t
      }
  }
  val arm by animateFloatAsState(if (playing) 1f else 0f, spring(dampingRatio = 0.8f, stiffness = 60f), label = "arm")
  Box(modifier) {
    Box(Modifier.fillMaxSize().padding(8.dp).shadow(24.dp, CircleShape).clip(CircleShape).graphicsLayer { rotationZ = angle }.drawWithCache {
      val c = size.minDimension / 2
      val center = Offset(size.width / 2, size.height / 2)
      val sheen = Brush.sweepGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.13f), Color.Transparent, Color.Transparent, Color.White.copy(alpha = 0.09f), Color.Transparent), center)
      onDrawBehind {
        drawCircle(Color(0xFF111111))
        // The grooves: fine rings, a lead-out gap near the label.
        var r = c * 0.97f
        var k = 0
        while (r > c * 0.4f) {
          drawCircle(if (k % 2 == 0) Color(0xFF1D1D1D) else Color(0xFF0C0C0C), r, center, style = Stroke(1.2f))
          r -= 2.4f
          k++
        }
        drawCircle(sheen)
      }
    }) {
      Box(Modifier.align(Alignment.Center).fillMaxSize(0.36f).clip(CircleShape)) {
        Artwork(cover, title, null, Modifier.fillMaxSize(), radius = 999.dp)
      }
      Canvas(Modifier.align(Alignment.Center).size(10.dp)) {
        drawCircle(Color(0xFF222222))
        drawCircle(Color(0xFF888888), radius = size.minDimension * 0.18f)
      }
    }
    Tonearm(arm, Modifier.fillMaxSize())
  }
}

/** The tonearm: its pivot top right, swung onto the record by [down] (0 parked, 1 playing). */
@Composable
private fun Tonearm(down: Float, modifier: Modifier) {
  Canvas(modifier) {
    val pivot = Offset(size.width * 0.93f, size.height * 0.08f)
    val len = size.height * 0.78f
    val a = (12f + 14f * down) * (PI / 180f).toFloat()
    val end = Offset(pivot.x - len * sin(a), pivot.y + len * cos(a))
    val w = size.minDimension * 0.028f
    // Its shadow on the record, then the chrome arm, the headshell and the pivot.
    drawLine(Color.Black.copy(alpha = 0.4f), pivot + Offset(w, w * 2), end + Offset(w, w * 2), w, StrokeCap.Round)
    drawLine(Brush.linearGradient(listOf(Color(0xFF9A9A9A), Color(0xFFF0F0F0), Color(0xFF9A9A9A)), pivot - Offset(w, 0f), pivot + Offset(w, 0f)), pivot, end, w, StrokeCap.Round)
    rotate(-(12f + 14f * down), end) {
      drawRoundRect(Color(0xFF2B2B2D), topLeft = end - Offset(w * 1.1f, 0f), size = Size(w * 2.2f, w * 3.2f), cornerRadius = androidx.compose.ui.geometry.CornerRadius(w * 0.4f))
    }
    drawCircle(Brush.radialGradient(listOf(Color(0xFFF4F4F6), Color(0xFF7D7E82)), pivot - Offset(w, w), w * 3.5f), w * 2.6f, pivot)
    drawCircle(Color(0xFF333333), w * 0.8f, pivot)
  }
}

/**
 * Two meters that move with the music: VU (the level, slow, as a VU meter is) and PEAK (fast up,
 * slow back), on cream faces with their arcs, from what is playing now.
 */
@Composable
fun VuMeters(modifier: Modifier = Modifier) {
  var vu by remember { mutableFloatStateOf(0f) }
  var peak by remember { mutableFloatStateOf(0f) }
  LaunchedEffect(Unit) {
    val buf = FloatArray(1024)
    while (true) {
      withFrameMillis { }
      var rms = 0f
      var pk = 0f
      if (AudioTap.window(buf)) {
        var s = 0f
        for (x in buf) {
          s += x * x
          pk = max(pk, abs(x))
        }
        rms = sqrt(s / buf.size)
      }
      // -30 dB … 0 dB across the scale.
      fun scale(v: Float) = ((20 * log10(max(v, 1e-5f)) + 30f) / 30f).coerceIn(0f, 1f)
      vu += (scale(rms * 1.6f) - vu) * 0.12f
      val p = scale(pk)
      peak = if (p > peak) p else peak + (p - peak) * 0.05f
    }
  }
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    Meter("VU", vu, Modifier.weight(1f))
    Meter("PEAK", peak, Modifier.weight(1f))
  }
}

@Composable
private fun Meter(label: String, v: Float, modifier: Modifier) {
  val tm = androidx.compose.ui.text.rememberTextMeasurer()
  Canvas(modifier.size(64.dp, 46.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(5.dp))) {
    drawRect(Brush.verticalGradient(listOf(Color(0xFFF6E7B8), Color(0xFFE9D396))))
    val pivot = Offset(size.width / 2, size.height * 1.15f)
    val r = size.height * 0.95f
    // The scale: an arc, its red end, and ticks.
    drawArc(Color(0xFF5A4A20), 230f, 80f, false, topLeft = pivot - Offset(r * 0.82f, r * 0.82f), size = Size(r * 1.64f, r * 1.64f), style = Stroke(1.5f))
    drawArc(Color(0xFFC8473A), 295f, 15f, false, topLeft = pivot - Offset(r * 0.82f, r * 0.82f), size = Size(r * 1.64f, r * 1.64f), style = Stroke(3f))
    for (i in 0..6) {
      val a = (230f + i * 80f / 6) * (PI / 180f).toFloat()
      drawLine(Color(0xFF5A4A20), pivot + Offset(cos(a), sin(a)) * (r * 0.82f), pivot + Offset(cos(a), sin(a)) * (r * 0.92f), 1.2f)
    }
    val a = (230f + 80f * v) * (PI / 180f).toFloat()
    drawLine(Color(0xFF1A1A1A), pivot, pivot + Offset(cos(a), sin(a)) * r, 1.8f)
    drawText(tm, label, Offset(6.dp.toPx(), size.height - 15.dp.toPx()), style = androidx.compose.ui.text.TextStyle(color = Color(0xFF5A4A20), fontSize = androidx.compose.ui.unit.TextUnit(8f, androidx.compose.ui.unit.TextUnitType.Sp), fontWeight = androidx.compose.ui.text.font.FontWeight(900)))
    drawRect(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.3f), Color.Transparent), 0f, 8.dp.toPx()))
  }
}

/** An aluminium knob: drag up or round to turn it; [value] 0 → 1 over 270°. */
@Composable
fun Knob(value: Float, onChange: (Float) -> Unit, label: String, size: Dp = 46.dp, onDetent: () -> Unit = {}) {
  var v by remember { mutableFloatStateOf(value) }
  v = value
  var lastStep by remember { mutableFloatStateOf((value * 20).toInt().toFloat()) }
  Canvas(
    Modifier.size(size)
      .semantics {
        contentDescription = label
        stateDescription = "${(value * 100).toInt()} percent"
        progressBarRangeInfo = androidx.compose.ui.semantics.ProgressBarRangeInfo(value, 0f..1f)
        setProgress { t ->
          onChange(t.coerceIn(0f, 1f))
          true
        }
      }
      .pointerInput(Unit) {
        detectDragGestures { change, drag ->
          change.consume()
          val nv = (v + (drag.x - drag.y) / 300f).coerceIn(0f, 1f)
          v = nv
          onChange(nv)
          val step = (nv * 20).toInt().toFloat()
          if (step != lastStep) {
            lastStep = step
            onDetent()
          }
        }
      }
      .shadow(6.dp, CircleShape),
  ) {
    val c = Offset(this.size.width / 2, this.size.height / 2)
    val r = this.size.minDimension / 2
    drawCircle(Brush.radialGradient(listOf(Color(0xFFF4F4F6), Color(0xFFA9AAAE), Color(0xFF7D7E82)), c - Offset(r * 0.25f, r * 0.3f), r * 1.3f), r, c)
    // Knurled rim: fine ridges round the edge.
    for (i in 0 until 48) {
      val a = i * (2 * PI / 48).toFloat()
      drawLine(Color.Black.copy(alpha = 0.18f), c + Offset(cos(a), sin(a)) * (r * 0.86f), c + Offset(cos(a), sin(a)) * r, 1f)
    }
    drawCircle(Color.White.copy(alpha = 0.25f), r * 0.82f, c, style = Stroke(r * 0.08f))
    val a = (-225f + 270f * value) * (PI / 180f).toFloat()
    drawLine(Color(0xFF333333), c + Offset(cos(a), sin(a)) * (r * 0.3f), c + Offset(cos(a), sin(a)) * (r * 0.72f), r * 0.11f, StrokeCap.Round)
  }
}

// ---- Paper ----

/** A strip of sticky tape, translucent yellow, a little crooked. */
@Composable
fun BoxScope.Tape(modifier: Modifier = Modifier, tilt: Float = -4f) {
  Canvas(modifier.size(70.dp, 22.dp).graphicsLayer { rotationZ = tilt }) {
    drawRect(Color.Black.copy(alpha = 0.1f), topLeft = Offset(1f, 2f))
    drawRect(Color(0xFFFFECAA).copy(alpha = 0.78f))
    // Torn ends: a few notches.
    for (x in listOf(0f, size.width)) for (k in 0..4) drawRect(Color.White.copy(alpha = 0.3f), topLeft = Offset(x - 1.5f, k * size.height / 5), size = Size(3f, size.height / 10))
  }
}

/** The origami play button: a folded pentagon with its creases, the glyph on it. */
@Composable
fun OrigamiPlay(playing: Boolean, size: Int, fill: Color, onClick: () -> Unit) {
  val (source, down) = rememberPress()
  Box(
    Modifier.size(size.dp).bouncy(scale = 0.92f, source = source, onClick = onClick).semantics { contentDescription = if (playing) "Pause" else "Play" }
      .drawWithCache {
        val w = this.size.width
        val h = this.size.height
        val p = Path().apply {
          moveTo(w / 2, 0f)
          lineTo(w, h * 0.38f)
          lineTo(w * 0.82f, h)
          lineTo(w * 0.18f, h)
          lineTo(0f, h * 0.38f)
          close()
        }
        val mid = Offset(w / 2, h * 0.55f)
        onDrawBehind {
          drawPath(p, Color.Black.copy(alpha = if (down) 0.08f else 0.16f), style = androidx.compose.ui.graphics.drawscope.Fill)
          translate(-2f, if (down) -1f else -4f) {
            drawPath(p, fill)
            // The folds: each face to the centre, lit on the left, shaded on the right.
            val corners = listOf(Offset(w / 2, 0f), Offset(w, h * 0.38f), Offset(w * 0.82f, h), Offset(w * 0.18f, h), Offset(0f, h * 0.38f))
            for (i in corners.indices) {
              val a = corners[i]
              val b = corners[(i + 1) % corners.size]
              val face = Path().apply {
                moveTo(a.x, a.y)
                lineTo(b.x, b.y)
                lineTo(mid.x, mid.y)
                close()
              }
              drawPath(face, if (i < 2) Color.White.copy(alpha = 0.16f * (2 - i)) else Color.Black.copy(alpha = 0.05f * (i - 1)))
              drawLine(Color.Black.copy(alpha = 0.12f), a, mid, 1.2f)
            }
          }
        }
      },
    contentAlignment = Alignment.Center,
  ) { Icon(if (playing) EchoIcons.pause else EchoIcons.play, null, tint = Color.White, modifier = Modifier.size((size * 0.36f).dp)) }
}
