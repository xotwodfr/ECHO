package com.folk3s.echo.ui

import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import com.folk3s.echo.stage.GlassParams

// Liquid glass in the Shell (DESIGN_SYSTEM.md §7.11, ui/glass.ts on the web): what lies behind a
// glass surface is recorded once per frame into a layer (the backdrop), and each surface draws it
// frosted and bent through its rim. API 33+: an AGSL shader with the same Snell's-law rim as the
// web's SVG filter and GL pass; 31–32: frost and saturation (the web's Firefox fallback); below
// 31, nothing to blur with: the surface is opaque, like reduced transparency.

/** The share of its surface colour a Shell glass surface keeps: 80%, AA text over any cover. */
const val GLASS_FILL = 0.8f

@Stable
class Backdrop(val layer: GraphicsLayer) {
  var origin by mutableStateOf(Offset.Zero)
}

val LocalBackdrop = staticCompositionLocalOf<Backdrop?> { null }

@Composable
fun rememberBackdrop(): Backdrop {
  val layer = rememberGraphicsLayer()
  return remember(layer) { Backdrop(layer) }
}

/** Draws this content as usual and records it as the backdrop the glass surfaces above it bend. */
fun Modifier.backdropSource(b: Backdrop): Modifier =
  onGloballyPositioned { b.origin = it.positionInRoot() }
    .drawWithContent {
      b.layer.record { this@drawWithContent.drawContent() }
      drawLayer(b.layer)
    }

// The rim's bend computed in the shader (AGSL cannot index uniform arrays by a runtime value).
private const val GLASS_AGSL = """
uniform shader content;
uniform float2 size;
uniform float4 radii;
uniform float bezel;
uniform float thickness;
uniform float ior;
uniform float refraction;
uniform float spec;
uniform float2 light;
uniform float sat;

float rimH(float t) { return pow(1.0 - pow(1.0 - t, 4.0), 0.25); }

float bendAt(float t) {
  float slope = (rimH(min(t + 0.001, 1.0)) - rimH(t)) / 0.001;
  float inc = atan(slope);
  float dev = inc - asin(sin(inc) / ior);
  return (thickness + rimH(t) * bezel) * tan(dev) * refraction;
}

half4 main(float2 p) {
  float2 h = size * 0.5;
  float2 d = p - h;
  float r = d.y < 0.0 ? (d.x < 0.0 ? radii.x : radii.y) : (d.x < 0.0 ? radii.w : radii.z);
  float2 q = abs(d) - (h - r);
  float depth;
  float2 n;
  if (q.x > 0.0 && q.y > 0.0) {
    depth = r - length(q);
    n = normalize(q) * sign(d);
  } else {
    depth = r - max(q.x, q.y);
    n = q.x > q.y ? float2(sign(d.x), 0.0) : float2(0.0, sign(d.y));
  }
  float bz = max(1.0, min(bezel, min(h.x, h.y)));
  float2 at = p;
  float rim = 0.0;
  if (depth >= 0.0 && depth < bz) {
    float edge = clamp(depth, 0.0, 1.0);
    at -= n * bendAt(depth / bz) * edge;
    rim = spec * abs(dot(n, light)) * pow(1.0 - depth / bz, 6.0) * edge;
  }
  half4 c = content.eval(at);
  half l = dot(c.rgb, half3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(half3(l), c.rgb, half(sat));
  c.rgb = mix(c.rgb, half3(1.0), half(rim));
  return c;
}
"""

private fun saturation(s: Float): RenderEffect =
  RenderEffect.createColorFilterEffect(ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(s) }))

@RequiresApi(33)
private fun glassEffect(s: RuntimeShader, size: IntSize, radiusPx: Float, px: Float, g: GlassParams): RenderEffect {
  s.setFloatUniform("size", size.width.toFloat(), size.height.toFloat())
  s.setFloatUniform("radii", radiusPx, radiusPx, radiusPx, radiusPx)
  s.setFloatUniform("bezel", (g.bezel * px).toFloat())
  s.setFloatUniform("thickness", (g.thickness * px).toFloat())
  s.setFloatUniform("ior", g.ior.toFloat())
  s.setFloatUniform("refraction", g.refraction.toFloat())
  s.setFloatUniform("spec", g.specular.toFloat())
  val a = Math.toRadians(g.light)
  s.setFloatUniform("light", Math.cos(a).toFloat(), -Math.sin(a).toFloat())
  s.setFloatUniform("sat", g.saturate.toFloat())
  val frost = (g.frost * px).toFloat()
  return RenderEffect.createChainEffect(RenderEffect.createRuntimeShaderEffect(s, "content"), RenderEffect.createBlurEffect(frost, frost, Shader.TileMode.CLAMP))
}

val glassAvailable: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

/**
 * A glass surface: the backdrop behind it, frosted and bent, under its own colour at [GLASS_FILL].
 * Without a backdrop, or on a platform that cannot blur, it is that colour, opaque.
 */
@Composable
fun GlassSurface(color: Color, shape: Shape, radius: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier, fill: Float = GLASS_FILL, content: @Composable () -> Unit) {
  val b = LocalBackdrop.current
  val px = LocalDensity.current.density
  val glassLayer = rememberGraphicsLayer()
  // One shader per surface; only its uniforms change from frame to frame.
  val shader = remember { if (Build.VERSION.SDK_INT >= 33) RuntimeShader(GLASS_AGSL) else null }
  var at by remember { mutableStateOf(Offset.Zero) }
  val glass = b != null && glassAvailable
  Box(
    modifier
      .onGloballyPositioned { at = it.positionInRoot() }
      .clip(shape)
      .drawBehind {
        if (!glass) return@drawBehind drawRect(color)
        val size = IntSize(size.width.toInt().coerceAtLeast(1), size.height.toInt().coerceAtLeast(1))
        glassLayer.record(size) { translate(b!!.origin.x - at.x, b.origin.y - at.y) { drawLayer(b.layer) } }
        val g = GlassParams()
        glassLayer.renderEffect =
          (if (Build.VERSION.SDK_INT >= 33) glassEffect(shader!!, size, radius.toPx(), px, g)
          else RenderEffect.createChainEffect(saturation(g.saturate.toFloat()), RenderEffect.createBlurEffect((g.frost * px).toFloat(), (g.frost * px).toFloat(), Shader.TileMode.CLAMP)))
            .asComposeRenderEffect()
        drawLayer(glassLayer)
        drawRect(color.copy(alpha = color.alpha * fill))
      },
  ) { content() }
}
