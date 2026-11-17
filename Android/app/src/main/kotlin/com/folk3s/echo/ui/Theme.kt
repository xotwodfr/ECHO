package com.folk3s.echo.ui

import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
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

// ECHO v0.2 (2026-11-17): large bold titles, rounded art, a floating mini player and a full-screen
// Now Playing on the album's colours, in Material 3's components. The scheme is the M3 content
// scheme of the playing album's accent, light or dark with the system, animated over 1200 ms.

/** The frame's colours as M3 roles (tokens.css): read in composition, they follow the album. */
object Chamber {
  private val c @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme
  val ground @Composable @ReadOnlyComposable get() = c.surface
  val surface1 @Composable @ReadOnlyComposable get() = c.surface
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
    // Big, bold, tight headings (the large-title look); the body stays the M3 scale.
    displayLarge = style(800, 57, 64, -0.5),
    displayMedium = style(800, 45, 52, -0.5),
    displaySmall = style(800, 34, 40, -0.5),
    headlineLarge = style(800, 32, 40, -0.4),
    headlineMedium = style(800, 26, 32, -0.3),
    headlineSmall = style(750, 21, 28, -0.2),
    titleLarge = style(700, 20, 26, -0.1),
    titleMedium = style(600, 16, 24, 0.15),
    titleSmall = style(600, 14, 20, 0.1),
    bodyLarge = style(400, 16, 24, 0.5),
    bodyMedium = style(400, 14, 20, 0.25),
    bodySmall = style(400, 12, 16, 0.4),
    labelLarge = style(600, 14, 20, 0.1),
    labelMedium = style(600, 12, 16, 0.5),
    labelSmall = style(600, 11, 16, 0.5),
  )

/**
 * The app's theme: light or dark with the system, the scheme seeded by the playing album's accent.
 * [dark] forces the dark scheme (Now Playing and the lyrics view sit on the album's colours).
 */
@Composable
fun EchoTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
  DynamicMaterialTheme(
    seedColor = stagePalette().accentColor,
    isDark = dark,
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
