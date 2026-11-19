package com.folk3s.echo.ui

import android.graphics.Bitmap
import android.graphics.PathMeasure
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

// Materials (v0.4, 2026-11-18): the Clay and Yarn themes draw every surface as a real material.
// Clay: matte modelling clay lit from the top left (a highlight, a shaded far side, a rim of
// light and a dark rim, a fine grain, the odd fingerprint), shaped by hand (corners and edges a
// little uneven); pressed, it sinks in. Yarn: knitted fabric (every stitch lit and shaded), puffed
// like a cushion, with fuzz along its edges, ribbing on bars and stitched seams; pressed, it gives.
// "Flat" is every other theme: a plain rounded surface.
// v0.6: Liquid glass (frosted panes, light bending and catching at the edges, a reflection across
// them), Paper (thick card with layered cut-paper shadows, creases and dog-eared corners) and
// Retro hi-fi (brushed aluminium with a bevel and corner screws, on a wood-veneer cabinet).

enum class Material { Flat, Clay, Yarn, Glass, Paper, HiFi }

/** The material's colours: the ground pages sit on, the paper for frames and bars, the accents. */
@Immutable
data class MatterColors(
  val ground: Color,
  val paper: Color,
  val accents: List<Color>,
  val ink: Color,
  val onAccent: Color,
  /** Play, the playing track, the chosen tab: the material's boldest colour. */
  val strong: Color = accents.last(),
) {
  fun accent(i: Int): Color = accents[((i % accents.size) + accents.size) % accents.size]
}

val LocalMatter = staticCompositionLocalOf { MatterColors(Color.White, Color.White, listOf(Color.Gray), Color.Black, Color.White) }

val matter: MatterColors @Composable @ReadOnlyComposable get() = LocalMatter.current

private fun Color.darker(k: Float) = lerp(this, Color.Black, k)

private fun Color.lighter(k: Float) = lerp(this, Color.White, k)

// ---- Textures, made once ----

private object Textures {
  /** Clay's grain: soft noise, mid-grey to white, to multiply over the colour. */
  val grain: ImageBitmap by lazy {
    val n = 160
    val rnd = Random(11)
    val px = IntArray(n * n)
    // Two octaves: fine speckle on a coarse mottle.
    val coarse = Array(n / 8 + 2) { FloatArray(n / 8 + 2) { rnd.nextFloat() } }
    for (y in 0 until n) for (x in 0 until n) {
      val cx = x / 8f
      val cy = y / 8f
      val ix = cx.toInt()
      val iy = cy.toInt()
      val fx = cx - ix
      val fy = cy - iy
      val m = (coarse[iy][ix] * (1 - fx) + coarse[iy][ix + 1] * fx) * (1 - fy) + (coarse[iy + 1][ix] * (1 - fx) + coarse[iy + 1][ix + 1] * fx) * fy
      val v = (0.78f + 0.12f * m + 0.16f * rnd.nextFloat()).coerceIn(0f, 1f)
      val c = (v * 255).toInt()
      px[y * n + x] = (0xFF shl 24) or (c shl 16) or (c shl 8) or c
    }
    Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888).asImageBitmap()
  }

  /** Paper's fibres: a pale ground with short dark and light fibres, to multiply over the card. */
  val fibre: ImageBitmap by lazy {
    val n = 192
    val rnd = Random(23)
    val bmp = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
    val c = android.graphics.Canvas(bmp)
    c.drawColor(0xFFF4F2EE.toInt())
    val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    p.strokeCap = android.graphics.Paint.Cap.ROUND
    repeat(900) {
      val x = rnd.nextFloat() * n
      val y = rnd.nextFloat() * n
      val a = rnd.nextFloat() * Math.PI.toFloat()
      val l = 2f + rnd.nextFloat() * 7f
      p.strokeWidth = 0.5f + rnd.nextFloat() * 0.7f
      p.color = if (rnd.nextFloat() < 0.6f) android.graphics.Color.argb(26 + rnd.nextInt(30), 90, 70, 50) else android.graphics.Color.argb(60, 255, 255, 255)
      for (dx in intArrayOf(-n, 0, n)) for (dy in intArrayOf(-n, 0, n)) c.drawLine(x + dx, y + dy, x + dx + cos(a) * l, y + dy + sin(a) * l, p)
    }
    bmp.asImageBitmap()
  }

  /** Brushed aluminium: fine horizontal streaks, each row its own brightness. */
  val brushed: ImageBitmap by lazy {
    val w = 256
    val h = 128
    val rnd = Random(5)
    val px = IntArray(w * h)
    for (y in 0 until h) {
      val row = 0.82f + 0.18f * rnd.nextFloat()
      for (x in 0 until w) {
        val v = (row + 0.06f * (rnd.nextFloat() - 0.5f) + 0.05f * sin((x + y * 7) * 0.05f)).coerceIn(0f, 1f)
        val c = (v * 255).toInt()
        px[y * w + x] = (0xFF shl 24) or (c shl 16) or (c shl 8) or c
      }
    }
    Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888).asImageBitmap()
  }

  private val woods = HashMap<Int, ImageBitmap>()

  /** Wood veneer: vertical grain in a few browns, with darker pores, a tile [unit] px tall. */
  fun wood(unit: Int): ImageBitmap =
    woods.getOrPut(unit) {
      val w = 240
      val h = unit * 8
      val rnd = Random(41)
      val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val c = android.graphics.Canvas(bmp)
      val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
      val browns = intArrayOf(0xFF6B3F22.toInt(), 0xFF7A4A29.toInt(), 0xFF5E361C.toInt(), 0xFF7D4D2B.toInt(), 0xFF6F4224.toInt())
      var x = 0f
      while (x < w) {
        val sw = 2f + rnd.nextFloat() * 6f
        p.color = browns[rnd.nextInt(browns.size)]
        c.drawRect(x, 0f, x + sw + 0.6f, h.toFloat(), p)
        x += sw
      }
      // Grain lines that wander a little down the board, and pores.
      p.style = android.graphics.Paint.Style.STROKE
      repeat(28) {
        val gx = rnd.nextFloat() * w
        val path = android.graphics.Path()
        path.moveTo(gx, 0f)
        var y = 0f
        var cx = gx
        while (y < h) {
          y += h / 6f
          cx += (rnd.nextFloat() - 0.5f) * 3f
          path.lineTo(cx, y)
        }
        p.strokeWidth = 0.6f + rnd.nextFloat()
        p.color = if (rnd.nextBoolean()) 0x30000000 else 0x18FFE0C0
        c.drawPath(path, p)
      }
      p.style = android.graphics.Paint.Style.FILL
      p.color = 0x28000000
      repeat(500) {
        val px0 = rnd.nextFloat() * w
        val py0 = rnd.nextFloat() * h
        c.drawRect(px0, py0, px0 + 0.8f, py0 + 2.5f, p)
      }
      bmp.asImageBitmap()
    }

  private val knits = HashMap<Int, ImageBitmap>()
  private val ribs = HashMap<Int, ImageBitmap>()

  /** A tile of knitting: a pair of V stitches, each loop lit on top and shaded underneath. */
  fun knit(unit: Int): ImageBitmap =
    knits.getOrPut(unit) {
      val w = unit * 2
      val h = (unit * 2.15f).toInt()
      val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val c = android.graphics.Canvas(bmp)
      val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
      fun loop(cx: Float, angle: Float) {
        c.save()
        c.rotate(angle, cx, h / 2f)
        val r = android.graphics.RectF(cx - unit * 0.36f, h * 0.06f, cx + unit * 0.36f, h * 0.94f)
        // Lit from above: bright top, deep bottom; the gap between loops dark.
        p.style = android.graphics.Paint.Style.FILL
        p.shader = android.graphics.LinearGradient(0f, r.top, 0f, r.bottom, intArrayOf(0x66FFFFFF, 0x10FFFFFF, 0x40000000), floatArrayOf(0f, 0.45f, 1f), android.graphics.Shader.TileMode.CLAMP)
        c.drawOval(r, p)
        p.shader = null
        p.style = android.graphics.Paint.Style.STROKE
        p.strokeWidth = unit * 0.07f
        p.color = 0x55000000
        c.drawOval(r, p)
        // The twist of the yarn: a few fine fibres across the loop.
        p.strokeWidth = unit * 0.035f
        p.color = 0x22FFFFFF
        for (k in 1..3) {
          val y = r.top + r.height() * k / 4f
          c.drawLine(r.left + unit * 0.08f, y - unit * 0.12f, r.right - unit * 0.08f, y + unit * 0.12f, p)
        }
        c.restore()
      }
      loop(unit * 0.5f, -26f)
      loop(unit * 1.5f, 26f)
      bmp.asImageBitmap()
    }

  /** A tile of ribbing: knit columns raised, purl columns sunk. */
  fun rib(unit: Int): ImageBitmap =
    ribs.getOrPut(unit) {
      val w = unit
      val h = unit
      val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val c = android.graphics.Canvas(bmp)
      val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
      p.shader = android.graphics.LinearGradient(0f, 0f, w.toFloat(), 0f, intArrayOf(0x55000000, 0x30FFFFFF, 0x55FFFFFF, 0x20FFFFFF, 0x66000000), null, android.graphics.Shader.TileMode.CLAMP)
      c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), p)
      bmp.asImageBitmap()
    }
}

// ---- Hand-made shapes ----

/** A rounded rectangle as a hand would shape it: each corner its own radius, each edge a little bowed. */
class HandShape(private val radius: Dp, private val seed: Int, private val wobble: Float) : Shape {
  override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
    val rnd = Random(seed)
    val maxR = min(size.width, size.height) / 2
    val base = with(density) { radius.toPx() }.coerceAtMost(maxR)
    fun r() = (base * (1 + wobble * (rnd.nextFloat() * 2 - 1))).coerceIn(0f, maxR)
    val tl = r()
    val tr = r()
    val br = r()
    val bl = r()
    fun bow(len: Float) = len * wobble * 0.05f * (rnd.nextFloat() * 2 - 1)
    val w = size.width
    val h = size.height
    val p = Path()
    p.moveTo(tl, 0f)
    p.quadraticTo(w / 2, bow(w), w - tr, 0f)
    p.quadraticTo(w, 0f, w, tr)
    p.quadraticTo(w + bow(h), h / 2, w, h - br)
    p.quadraticTo(w, h, w - br, h)
    p.quadraticTo(w / 2, h + bow(w), bl, h)
    p.quadraticTo(0f, h, 0f, h - bl)
    p.quadraticTo(bow(h), h / 2, 0f, tl)
    p.quadraticTo(0f, 0f, tl, 0f)
    p.close()
    return Outline.Generic(p)
  }
}

private fun Outline.path(): Path =
  when (this) {
    is Outline.Generic -> path
    is Outline.Rounded -> Path().apply { addRoundRect(roundRect) }
    is Outline.Rectangle -> Path().apply { addRect(rect) }
  }

// ---- The modifier ----

/**
 * A surface in the theme's material: [color] filling a rounded shape of [radius]. Clay and Yarn
 * draw the real thing, raised (or sunk while [pressed]); other themes, a plain rounded surface.
 * [seed] varies the hand-made details between neighbours; [rib] knits a bar in ribbing; [seam]
 * stitches a seam inside the edge.
 */
@Composable
fun Modifier.matter(color: Color, radius: Dp, pressed: Boolean = false, seed: Int = 0, depth: Float = 1f, rib: Boolean = false, seam: Boolean = false): Modifier {
  val material = look.material
  val density = androidx.compose.ui.platform.LocalDensity.current
  return when (material) {
    Material.Flat -> this.clip(androidx.compose.foundation.shape.RoundedCornerShape(radius)).background(color)
    Material.Clay -> {
      val shape = HandShape(radius, seed, 0.16f)
      val shade = color.darker(0.55f)
      this.shadow(if (pressed) 0.dp else 12.dp * depth, shape, clip = false, ambientColor = shade, spotColor = shade).then(clayBody(color, shape, pressed, seed, density))
    }
    Material.Yarn -> {
      val shape = HandShape(radius, seed, 0.06f)
      val shade = color.darker(0.6f)
      this.shadow(if (pressed) 1.dp else 9.dp * depth, shape, clip = false, ambientColor = shade, spotColor = shade).then(yarnBody(color, shape, pressed, seed, rib, seam, density))
    }
    Material.Glass -> {
      val shape = androidx.compose.foundation.shape.RoundedCornerShape(radius)
      val shade = Color(0xFF14002A)
      this.shadow(if (pressed) 2.dp else 10.dp * depth, shape, clip = false, ambientColor = shade, spotColor = shade).then(glassBody(color, shape, pressed, density))
    }
    Material.Paper -> {
      val big = seed % 3 == 0
      this.then(paperBody(color, radius.coerceAtMost(4.dp), pressed, seed, big, depth, density))
    }
    Material.HiFi -> {
      val shape = androidx.compose.foundation.shape.RoundedCornerShape(radius.coerceAtMost(10.dp))
      this.shadow(if (pressed) 1.dp else 8.dp * depth, shape, clip = false, ambientColor = Color.Black, spotColor = Color.Black).then(hifiBody(color, shape, pressed, density))
    }
  }
}

/**
 * Liquid glass: the colour as a tint in a frosted pane, lighter at the top; light catching the
 * top-left edge and fading round to the bottom right; a reflection slanting across. Pressed, the
 * pane brightens and the reflection goes.
 */
private fun glassBody(color: Color, shape: Shape, pressed: Boolean, density: Density) =
  Modifier.drawWithCache {
    val path = shape.createOutline(size, layoutDirection, this).path()
    val w = size.width
    val h = size.height
    val tint = color.copy(alpha = (if (color.luminance() > 0.8f) 0.16f else 0.3f) + if (pressed) 0.12f else 0f)
    val frost = Brush.verticalGradient(0f to Color.White.copy(alpha = 0.2f), 0.45f to Color.White.copy(alpha = 0.04f), 1f to Color.White.copy(alpha = 0.1f))
    val edge = with(density) { 1.4.dp.toPx() }
    val rim = Brush.linearGradient(0f to Color.White.copy(alpha = 0.85f), 0.35f to Color.White.copy(alpha = 0.25f), 0.7f to Color.White.copy(alpha = 0.08f), 1f to Color.White.copy(alpha = 0.3f), start = Offset.Zero, end = Offset(w * 0.6f, h))
    // The reflection: a soft slanted band across the left part of the pane.
    val sheen = Brush.linearGradient(0.42f to Color.Transparent, 0.5f to Color.White.copy(alpha = 0.22f), 0.58f to Color.Transparent, start = Offset(-w * 0.3f, 0f), end = Offset(w * 0.5f, h * 0.9f))
    // Light bending at the bottom edge: a thin bright caustic.
    val caustic = Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.35f), Color.Transparent))
    onDrawBehind {
      clipPath(path) {
        drawRect(tint)
        drawRect(frost)
        if (!pressed) drawRect(sheen)
        drawRect(caustic, topLeft = Offset(w * 0.15f, h - edge * 1.5f), size = Size(w * 0.7f, edge))
        drawPath(path, rim, style = Stroke(width = edge * 2))
      }
    }
  }

/** A card with a dog-eared top-right corner when [dog]; the corner's size in px. */
private class PaperShape(private val radius: Dp, private val dog: Float) : Shape {
  override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
    val r = with(density) { radius.toPx() }.coerceAtMost(min(size.width, size.height) / 2)
    val p = Path()
    p.addRoundRect(RoundRect(0f, 0f, size.width, size.height, androidx.compose.ui.geometry.CornerRadius(r)))
    if (dog <= 0f) return Outline.Generic(p)
    val corner = Path().apply {
      moveTo(size.width - dog, 0f)
      lineTo(size.width + 1, 0f)
      lineTo(size.width + 1, dog)
      close()
    }
    return Outline.Generic(Path().apply { op(p, corner, androidx.compose.ui.graphics.PathOperation.Difference) })
  }
}

/**
 * Paper: thick card with its fibres, two layered cut-paper shadows (a crisp one and a soft one),
 * on bigger pieces a crease catching the light and now and then a dog-eared corner. Pressed, it
 * lies flat.
 */
private fun paperBody(color: Color, radius: Dp, pressed: Boolean, seed: Int, mayFold: Boolean, depth: Float, density: Density) =
  Modifier.drawWithCache {
    val w = size.width
    val h = size.height
    val m = min(w, h)
    val big = m > with(density) { 72.dp.toPx() }
    val dog = if (big && mayFold) with(density) { 22.dp.toPx() } else 0f
    val path = PaperShape(radius, dog).createOutline(size, layoutDirection, this).path()
    val fibre = ShaderBrush(ImageShader(Textures.fibre, TileMode.Repeated, TileMode.Repeated))
    val near = with(density) { (if (pressed) 0.5.dp else 1.5.dp).toPx() } * depth
    val far = with(density) { (if (pressed) 1.dp else 4.dp).toPx() } * depth
    val rnd = Random(seed * 13 + 5)
    val crease = big && seed % 2 == 0
    val cx = w * (0.3f + 0.4f * rnd.nextFloat())
    val tilt = h * (0.35f + 0.3f * rnd.nextFloat())
    val line = with(density) { 1.dp.toPx() }
    onDrawBehind {
      // The shadows: a soft one far off, a crisp one close, as cut paper layered on a page.
      translate(far * 0.6f, far) { drawPath(path, Color(0xFF46321E).copy(alpha = 0.10f)) }
      translate(far * 0.3f, far * 0.55f) { drawPath(path, Color(0xFF46321E).copy(alpha = 0.08f)) }
      translate(near * 0.5f, near) { drawPath(path, Color.Black.copy(alpha = 0.12f)) }
      clipPath(path) {
        drawRect(color)
        drawRect(fibre, blendMode = BlendMode.Multiply)
        if (crease) {
          // A fold that was opened again: a shaded side and a lit side either side of the line.
          drawLine(Color.Black.copy(alpha = 0.07f), Offset(cx - tilt * 0.45f, 0f), Offset(cx + tilt * 0.45f, h), line * 2)
          drawLine(Color.White.copy(alpha = 0.5f), Offset(cx - tilt * 0.45f + line * 1.5f, 0f), Offset(cx + tilt * 0.45f + line * 1.5f, h), line)
        }
        if (pressed) drawRect(Color.Black.copy(alpha = 0.04f))
      }
      if (dog > 0f) {
        // The folded-down corner: the back of the card, lit, with a shadow on the face under it.
        val flap = Path().apply {
          moveTo(w - dog, 0f)
          lineTo(w - dog, dog)
          lineTo(w, dog)
          close()
        }
        translate(-line, line * 1.5f) { drawPath(flap, Color.Black.copy(alpha = 0.12f)) }
        drawPath(flap, Brush.linearGradient(listOf(color.lighter(0.5f), color.darker(0.06f)), start = Offset(w - dog, dog), end = Offset(w - dog * 0.5f, dog * 0.5f)))
      }
    }
  }

/** Retro hi-fi: brushed aluminium in the colour, a bevel (lit top edge, dark bottom), screws in the corners of panels. */
private fun hifiBody(color: Color, shape: Shape, pressed: Boolean, density: Density) =
  Modifier.drawWithCache {
    val path = shape.createOutline(size, layoutDirection, this).path()
    val w = size.width
    val h = size.height
    val brushed = ShaderBrush(ImageShader(Textures.brushed, TileMode.Repeated, TileMode.Repeated))
    val bevel = with(density) { 1.2.dp.toPx() }
    val face =
      if (!pressed) Brush.verticalGradient(0f to Color.White.copy(alpha = 0.16f), 0.5f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.16f))
      else Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.22f), 1f to Color.White.copy(alpha = 0.06f))
    val panel = w > with(density) { 150.dp.toPx() } && h > with(density) { 56.dp.toPx() }
    val sr = with(density) { 3.2.dp.toPx() }
    val inset = with(density) { 8.dp.toPx() }
    onDrawBehind {
      clipPath(path) {
        drawRect(color)
        drawRect(brushed, blendMode = BlendMode.Multiply)
        drawRect(face)
        drawLine(Color.White.copy(alpha = if (pressed) 0.1f else 0.55f), Offset(0f, bevel / 2), Offset(w, bevel / 2), bevel)
        drawLine(Color.Black.copy(alpha = if (pressed) 0.2f else 0.45f), Offset(0f, h - bevel / 2), Offset(w, h - bevel / 2), bevel)
      }
      if (panel)
        for ((x, y) in listOf(inset to inset, w - inset to inset, inset to h - inset, w - inset to h - inset)) {
          drawCircle(Brush.radialGradient(listOf(Color.White, Color(0xFF8A8A8A)), Offset(x - sr * 0.3f, y - sr * 0.3f), sr * 1.4f), sr, Offset(x, y))
          drawCircle(Color.Black.copy(alpha = 0.35f), sr, Offset(x, y), style = Stroke(bevel * 0.6f))
          drawLine(Color.Black.copy(alpha = 0.5f), Offset(x - sr * 0.6f, y + sr * 0.3f), Offset(x + sr * 0.6f, y - sr * 0.3f), bevel * 0.8f)
        }
    }
  }

private fun clayBody(color: Color, shape: Shape, pressed: Boolean, seed: Int, density: Density) =
  Modifier.drawWithCache {
    val path = shape.createOutline(size, layoutDirection, this).path()
    val grain = ShaderBrush(ImageShader(Textures.grain, TileMode.Repeated, TileMode.Repeated))
    val light = Color.White
    val dark = color.darker(0.5f)
    val w = size.width
    val h = size.height
    val m = min(w, h)
    val rim = with(density) { 2.2.dp.toPx() }
    // Lit from the top left: a soft highlight there, the far side in shade; pressed, the reverse.
    val face =
      if (!pressed) Brush.linearGradient(0f to light.copy(alpha = 0.34f), 0.42f to Color.Transparent, 1f to dark.copy(alpha = 0.32f), start = Offset.Zero, end = Offset(w, h))
      else Brush.linearGradient(0f to dark.copy(alpha = 0.38f), 0.5f to Color.Transparent, 1f to light.copy(alpha = 0.3f), start = Offset.Zero, end = Offset(w, h))
    val gloss = Brush.radialGradient(listOf(light.copy(alpha = if (pressed) 0f else 0.42f), Color.Transparent), Offset(w * 0.28f, h * 0.22f), m * 0.55f)
    val rimBrush =
      if (!pressed) Brush.linearGradient(0f to light.copy(alpha = 0.75f), 0.5f to light.copy(alpha = 0.05f), 0.55f to dark.copy(alpha = 0.05f), 1f to dark.copy(alpha = 0.55f), start = Offset.Zero, end = Offset(w, h))
      else Brush.linearGradient(0f to dark.copy(alpha = 0.6f), 0.5f to Color.Transparent, 1f to light.copy(alpha = 0.6f), start = Offset.Zero, end = Offset(w, h))
    // A fingerprint on bigger pieces, now and then: the whorl of a thumb pressed into the clay.
    val print = (seed % 3 == 0) && m > with(density) { 90.dp.toPx() }
    val rnd = Random(seed * 31 + 7)
    val pc = Offset(w * (0.62f + 0.25f * rnd.nextFloat()), h * (0.18f + 0.3f * rnd.nextFloat()))
    val pr = with(density) { 15.dp.toPx() }
    val tilt = rnd.nextFloat() * 180f
    onDrawBehind {
      clipPath(path) {
        drawRect(color)
        drawRect(face)
        drawRect(gloss)
        drawRect(grain, alpha = 0.5f, blendMode = BlendMode.Multiply)
        if (print)
          for (k in 1..9) {
            val rr = pr * k / 9f
            val a0 = (tilt + k * 23f) % 360f
            drawArc(dark.copy(alpha = 0.09f), a0, 250f, false, topLeft = Offset(pc.x - rr * 0.8f, pc.y - rr), size = Size(rr * 1.6f, rr * 2f), style = Stroke(width = rim * 0.35f, cap = StrokeCap.Round))
          }
        // The rim: light catching the top-left edge, the bottom-right edge turning away.
        drawPath(path, rimBrush, style = Stroke(width = rim * 2))
      }
    }
  }

private fun yarnBody(color: Color, shape: Shape, pressed: Boolean, seed: Int, rib: Boolean, seam: Boolean, density: Density) =
  Modifier.drawWithCache {
    val path = shape.createOutline(size, layoutDirection, this).path()
    val unit = with(density) { 7.dp.toPx() }.toInt().coerceAtLeast(6)
    val tex = ShaderBrush(ImageShader(if (rib) Textures.rib(unit) else Textures.knit(unit), TileMode.Repeated, TileMode.Repeated))
    val w = size.width
    val h = size.height
    val m = min(w, h)
    // Puffed like a cushion: lighter in the middle, the edges rolling away into shade.
    val puff = Brush.radialGradient(listOf(Color.White.copy(alpha = if (pressed) 0.04f else 0.2f), Color.Transparent, Color.Black.copy(alpha = if (pressed) 0.3f else 0.22f)), Offset(w * 0.45f, h * 0.38f), maxOf(w, h) * 0.75f)
    val edge = with(density) { 6.dp.toPx() }
    // Fuzz: short fibres standing off the edge, in a lighter and a darker shade of the yarn.
    val hairs = ArrayList<Pair<Offset, Offset>>()
    val measure = PathMeasure(path.asAndroidPath(), true)
    val len = measure.length
    val rnd = Random(seed * 17 + 3)
    val pos = FloatArray(2)
    val tan = FloatArray(2)
    val step = with(density) { 3.5.dp.toPx() }
    var d = 0f
    while (d < len) {
      measure.getPosTan(d, pos, tan)
      val nx = tan[1]
      val ny = -tan[0]
      val l = with(density) { (1.2f + 2.6f * rnd.nextFloat()).dp.toPx() }
      val a = (rnd.nextFloat() - 0.5f) * 1.2f
      val dx = nx * cos(a) - ny * sin(a)
      val dy = nx * sin(a) + ny * cos(a)
      val o = Offset(pos[0] - nx * l * 0.4f, pos[1] - ny * l * 0.4f)
      hairs += o to Offset(o.x + dx * l, o.y + dy * l)
      d += step * (0.5f + rnd.nextFloat())
    }
    val hairLight = color.lighter(0.35f).copy(alpha = 0.7f)
    val hairDark = color.darker(0.25f).copy(alpha = 0.6f)
    val hairW = with(density) { 0.7.dp.toPx() }
    val inset = with(density) { 5.dp.toPx() }
    val seamPath =
      if (!seam) null
      else Path().apply { addRoundRect(RoundRect(inset, inset, w - inset, h - inset, androidx.compose.ui.geometry.CornerRadius((m / 2 - inset).coerceAtMost(with(density) { 20.dp.toPx() })))) }
    val dash = PathEffect.dashPathEffect(floatArrayOf(with(density) { 5.dp.toPx() }, with(density) { 3.5.dp.toPx() }))
    onDrawBehind {
      clipPath(path) {
        drawRect(color)
        drawRect(tex)
        drawRect(puff)
        // The rolled edge: darker just inside the outline.
        drawPath(path, Color.Black.copy(alpha = 0.18f), style = Stroke(width = edge))
        if (seamPath != null) {
          drawPath(seamPath, Color.Black.copy(alpha = 0.25f), style = Stroke(width = hairW * 3.2f, pathEffect = dash))
          translate(-hairW * 0.6f, -hairW * 0.6f) { drawPath(seamPath, Color(0xFFFFF6E6).copy(alpha = 0.85f), style = Stroke(width = hairW * 2.4f, pathEffect = dash)) }
        }
      }
      for ((i, h2) in hairs.withIndex()) drawLine(if (i % 3 == 0) hairDark else hairLight, h2.first, h2.second, hairW, StrokeCap.Round)
    }
  }

/** A page's ground in the material: clay with its grain, or a knitted throw. */
@Composable
fun Modifier.matterGround(color: Color, material: Material = look.material): Modifier {
  val density = androidx.compose.ui.platform.LocalDensity.current
  return when (material) {
    Material.Flat -> this.then(Modifier.drawWithCache { onDrawBehind { drawRect(color) } })
    Material.Clay ->
      this.then(
        Modifier.drawWithCache {
          val grain = ShaderBrush(ImageShader(Textures.grain, TileMode.Repeated, TileMode.Repeated))
          val vignette = Brush.radialGradient(listOf(Color.Transparent, color.darker(0.35f).copy(alpha = 0.35f)), Offset(size.width * 0.4f, size.height * 0.3f), maxOf(size.width, size.height))
          onDrawBehind {
            drawRect(color)
            drawRect(grain, alpha = 0.42f, blendMode = BlendMode.Multiply)
            drawRect(vignette)
          }
        },
      )
    Material.Yarn ->
      this.then(
        Modifier.drawWithCache {
          val unit = with(density) { 8.dp.toPx() }.toInt().coerceAtLeast(6)
          val tex = ShaderBrush(ImageShader(Textures.knit(unit), TileMode.Repeated, TileMode.Repeated))
          val vignette = Brush.radialGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.22f)), Offset(size.width * 0.5f, size.height * 0.35f), maxOf(size.width, size.height))
          onDrawBehind {
            drawRect(color)
            drawRect(tex, alpha = 0.85f)
            drawRect(vignette)
          }
        },
      )
    Material.Glass -> {
      val glowColors = matter.accents
      this.then(
        Modifier.drawWithCache {
          // The album's colours as soft light behind the glass: three glows on a deep ground.
          val w = size.width
          val h = size.height
          val glows = listOf(Triple(0.2f, 0.12f, 0), Triple(0.92f, 0.45f, 1), Triple(0.25f, 0.95f, 2))
          onDrawBehind {
            drawRect(color)
            for ((x, y, i) in glows) {
              val c = glowColors[i % glowColors.size]
              drawRect(Brush.radialGradient(listOf(c.copy(alpha = 0.85f), c.copy(alpha = 0f)), Offset(w * x, h * y), maxOf(w, h) * 0.55f))
            }
          }
        },
      )
    }
    Material.Paper ->
      this.then(
        Modifier.drawWithCache {
          val fibre = ShaderBrush(ImageShader(Textures.fibre, TileMode.Repeated, TileMode.Repeated))
          val vignette = Brush.radialGradient(listOf(Color.Transparent, Color(0xFF46321E).copy(alpha = 0.12f)), Offset(size.width * 0.5f, size.height * 0.4f), maxOf(size.width, size.height))
          onDrawBehind {
            drawRect(color)
            drawRect(fibre, blendMode = BlendMode.Multiply)
            drawRect(vignette)
          }
        },
      )
    Material.HiFi ->
      this.then(
        Modifier.drawWithCache {
          val unit = with(density) { 8.dp.toPx() }.toInt().coerceAtLeast(6)
          val wood = ShaderBrush(ImageShader(Textures.wood(unit), TileMode.Repeated, TileMode.Repeated))
          val shade = Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.12f), Color.Black.copy(alpha = 0.38f)))
          onDrawBehind {
            drawRect(wood)
            // The finish: the veneer tinted toward the theme's wood, darker toward the bottom.
            drawRect(color, alpha = 0.25f, blendMode = BlendMode.Color)
            drawRect(shade)
          }
        },
      )
  }
}

/** Ink that reads on [bg]: the material's ink on light colours, white on deep ones. */
fun inkOn(bg: Color, ink: Color): Color =
  when {
    bg.alpha < 1f -> ink // see-through (Liquid glass): what shows is the ground, so the material's ink
    bg.luminance() > 0.42f -> if (ink.luminance() < 0.3f) ink else Color(0xFF1E1E20)
    else -> Color.White
  }

/** Liquid glass's colours are tints of a see-through pane: a hair under opaque marks them so. */
const val SEE_THROUGH = 0.995f

/** An embroidery hoop: linen with its weave, held in a wooden ring. */
fun Modifier.hoop(): Modifier =
  this.then(
    Modifier.drawWithCache {
      val r = 26.dp.toPx()
      val ring = 7.dp.toPx()
      val weave = 4.dp.toPx()
      val linen = Color(0xFFF4ECDD)
      val shade = Brush.radialGradient(listOf(Color.Transparent, Color(0xFF5A3A1C).copy(alpha = 0.22f)), Offset(size.width / 2, size.height * 0.4f), maxOf(size.width, size.height) * 0.75f)
      onDrawBehind {
        drawRoundRect(Color.Black.copy(alpha = 0.35f), topLeft = Offset(4.dp.toPx(), 8.dp.toPx()), size = size, cornerRadius = androidx.compose.ui.geometry.CornerRadius(r))
        drawRoundRect(linen, cornerRadius = androidx.compose.ui.geometry.CornerRadius(r))
        var y = 0f
        while (y < size.height) {
          drawLine(Color(0xFF7A5A3C).copy(alpha = 0.07f), Offset(0f, y), Offset(size.width, y), 1f)
          y += weave
        }
        var x = 0f
        while (x < size.width) {
          drawLine(Color(0xFF7A5A3C).copy(alpha = 0.07f), Offset(x, 0f), Offset(x, size.height), 1f)
          x += weave
        }
        drawRoundRect(shade, cornerRadius = androidx.compose.ui.geometry.CornerRadius(r))
        // The ring: wood, lit on top, with its inner edge in shade.
        drawRoundRect(Brush.verticalGradient(listOf(Color(0xFFE0BE84), Color(0xFFB88E52), Color(0xFF8E6634))), cornerRadius = androidx.compose.ui.geometry.CornerRadius(r), style = Stroke(ring))
        drawRoundRect(Color(0xFF5A3A1C).copy(alpha = 0.4f), topLeft = Offset(ring / 2, ring / 2), size = Size(size.width - ring, size.height - ring), cornerRadius = androidx.compose.ui.geometry.CornerRadius(r - ring / 2), style = Stroke(2.dp.toPx()))
      }
    },
  )
