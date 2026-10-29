package com.folk3s.echo.ui

import androidx.compose.animation.core.tween
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.folk3s.echo.R
import com.folk3s.echo.stage.stagePalette
import com.materialkolor.DynamicMaterialTheme
import com.materialkolor.PaletteStyle
import com.materialkolor.dynamiccolor.ColorSpec

// ECHO: Spotify's layout, Material 3's surfaces (docs/DESIGN_SYSTEM.md Draft 5, 2026-10-29). The
// colour scheme is the dark M3 content scheme of the playing album's accent (the web's
// palette/m3.ts), animated over 1200 ms like the web's palette; Figtree everywhere.

/** The frame's colours as M3 roles (tokens.css): read in composition, they follow the album. */
object Chamber {
  private val c @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme
  val ground @Composable @ReadOnlyComposable get() = c.surfaceContainerLowest
  val surface1 @Composable @ReadOnlyComposable get() = c.surfaceContainerLow
  val surface2 @Composable @ReadOnlyComposable get() = c.surfaceContainer
  val surface3 @Composable @ReadOnlyComposable get() = c.surfaceContainerHigh
  val surface4 @Composable @ReadOnlyComposable get() = c.surfaceContainerHighest
  val line @Composable @ReadOnlyComposable get() = c.outlineVariant
  val control @Composable @ReadOnlyComposable get() = c.outline
  val text @Composable @ReadOnlyComposable get() = c.onSurface
  val muted @Composable @ReadOnlyComposable get() = c.onSurfaceVariant
  val faint @Composable @ReadOnlyComposable get() = c.onSurfaceVariant
  val green @Composable @ReadOnlyComposable get() = c.primary
  val negative @Composable @ReadOnlyComposable get() = c.error
  val headFallback @Composable @ReadOnlyComposable get() = c.surfaceContainerHighest
  val likedFrom = Color(0xFF450AF5)
  val likedTo = Color(0xFFC4EFD9)
}

private fun variable(res: Int, vararg weights: Int) =
  FontFamily(weights.map { w -> Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))) })

/** ECHO's face: Figtree (OFL), a free face close to Spotify's Circular. */
val Figtree = variable(R.font.figtree, 400, 500, 600, 700, 800, 900)

private fun style(weight: Int, size: Int, line: Int, tracking: Double) =
  TextStyle(fontFamily = Figtree, fontWeight = FontWeight(weight), fontSize = size.sp, lineHeight = line.sp, letterSpacing = tracking.sp)

/** The M3 type scale (tokens.css --md-sys-typescale-*), in Figtree. */
private val EchoTypography =
  Typography(
    displayLarge = style(400, 57, 64, -0.25),
    displayMedium = style(400, 45, 52, 0.0),
    displaySmall = style(400, 36, 44, 0.0),
    headlineLarge = style(400, 32, 40, 0.0),
    headlineMedium = style(400, 28, 36, 0.0),
    headlineSmall = style(400, 24, 32, 0.0),
    titleLarge = style(400, 22, 28, 0.0),
    titleMedium = style(600, 16, 24, 0.15),
    titleSmall = style(600, 14, 20, 0.1),
    bodyLarge = style(400, 16, 24, 0.5),
    bodyMedium = style(400, 14, 20, 0.25),
    bodySmall = style(400, 12, 16, 0.4),
    labelLarge = style(600, 14, 20, 0.1),
    labelMedium = style(600, 12, 16, 0.5),
    labelSmall = style(600, 11, 16, 0.5),
  )

@Composable
fun EchoTheme(content: @Composable () -> Unit) {
  DynamicMaterialTheme(
    seedColor = stagePalette().accentColor,
    isDark = true,
    style = PaletteStyle.Content,
    specVersion = ColorSpec.SpecVersion.SPEC_2025,
    typography = EchoTypography,
    animate = true,
    animationSpec = tween(1200),
  ) {
    // Pages draw on the frame, not on a Surface: on-surface text by default.
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface, content = content)
  }
}

/** The album's accent, for tints (the mini player, the Now Playing gradient). */
@Composable
fun albumAccent(): Color = stagePalette().accentColor

/**
 * Spotify's header tone from a cover's accent: mid-dark and never garish, so white text keeps its
 * contrast (tokens.css `[data-tint]`: OKLCH lightness 0.42, chroma at most 0.13).
 */
fun headerTone(accent: Color): Color {
  val hsv = FloatArray(3)
  android.graphics.Color.colorToHSV(android.graphics.Color.argb(255, (accent.red * 255).toInt(), (accent.green * 255).toInt(), (accent.blue * 255).toInt()), hsv)
  val s = hsv[1].coerceAtMost(0.62f)
  return Color(android.graphics.Color.HSVToColor(floatArrayOf(hsv[0], s, if (s < 0.08f) 0.33f else 0.42f)))
}
