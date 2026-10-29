package com.folk3s.echo.ui

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.folk3s.echo.R
import com.folk3s.echo.stage.stagePalette

// ECHO after Spotify (docs/DESIGN_SYSTEM.md, 2026-10-29): Spotify's fixed neutrals and its green,
// Figtree everywhere. The album palette only tints: page headers, the Now Playing screen and the
// mini player.

/** Spotify's palette (tokens.css). */
object Chamber {
  val ground = Color(0xFF000000)
  val surface1 = Color(0xFF121212)
  val surface2 = Color(0xFF1F1F1F)
  val surface3 = Color(0xFF2A2A2A)
  val surface4 = Color(0xFF333333)
  val line = Color(0xFF282828)
  val control = Color(0xFF727272)
  val text = Color(0xFFFFFFFF)
  val muted = Color(0xFFB3B3B3)
  val faint = Color(0xFFA7A7A7)
  val green = Color(0xFF1ED760)
  val greenPress = Color(0xFF1DB954)
  val negative = Color(0xFFF15E6C)
  val likedFrom = Color(0xFF450AF5)
  val likedTo = Color(0xFFC4EFD9)
  val headFallback = Color(0xFF535353)
}

private fun variable(res: Int, vararg weights: Int) =
  FontFamily(weights.map { w -> Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))) })

/** ECHO's face: Figtree (OFL), a free face close to Spotify's Circular. */
val Figtree = variable(R.font.figtree, 400, 500, 600, 700, 800, 900)

private fun style(weight: Int, size: Int, line: Int) =
  TextStyle(fontFamily = Figtree, fontWeight = FontWeight(weight), fontSize = size.sp, lineHeight = line.sp, letterSpacing = 0.sp)

private val EchoTypography =
  Typography(
    displayLarge = style(800, 48, 52),
    displayMedium = style(800, 40, 44),
    displaySmall = style(800, 32, 38),
    headlineLarge = style(800, 32, 38),
    headlineMedium = style(700, 26, 32),
    headlineSmall = style(700, 22, 28),
    titleLarge = style(700, 20, 26),
    titleMedium = style(700, 16, 22),
    titleSmall = style(700, 14, 20),
    bodyLarge = style(400, 16, 22),
    bodyMedium = style(400, 14, 20),
    bodySmall = style(400, 12, 16),
    labelLarge = style(700, 14, 20),
    labelMedium = style(600, 12, 16),
    labelSmall = style(600, 11, 14),
  )

private val SpotifyScheme =
  darkColorScheme(
    primary = Chamber.green,
    onPrimary = Chamber.ground,
    primaryContainer = Chamber.green,
    onPrimaryContainer = Chamber.ground,
    secondary = Chamber.text,
    onSecondary = Chamber.ground,
    secondaryContainer = Chamber.surface3,
    onSecondaryContainer = Chamber.text,
    tertiary = Chamber.text,
    background = Chamber.ground,
    onBackground = Chamber.text,
    surface = Chamber.surface1,
    onSurface = Chamber.text,
    surfaceVariant = Chamber.surface3,
    onSurfaceVariant = Chamber.muted,
    surfaceContainerLowest = Chamber.ground,
    surfaceContainerLow = Chamber.surface1,
    surfaceContainer = Chamber.surface2,
    surfaceContainerHigh = Chamber.surface3,
    surfaceContainerHighest = Chamber.surface4,
    inverseSurface = Chamber.text,
    inverseOnSurface = Chamber.ground,
    outline = Chamber.control,
    outlineVariant = Chamber.surface4,
    error = Chamber.negative,
    onError = Chamber.ground,
  )

@Composable
fun EchoTheme(content: @Composable () -> Unit) {
  MaterialTheme(colorScheme = SpotifyScheme, typography = EchoTypography) {
    // White text by default, as Spotify's: pages draw on the ground, not on a Surface.
    CompositionLocalProvider(LocalContentColor provides Chamber.text, content = content)
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
