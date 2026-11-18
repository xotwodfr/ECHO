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

enum class Material { Flat, Clay, Yarn }

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
  }
}

/** Ink that reads on [bg]: the material's ink on light colours, white on deep ones. */
fun inkOn(bg: Color, ink: Color): Color = if (bg.luminance() > 0.42f) ink else Color.White

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
