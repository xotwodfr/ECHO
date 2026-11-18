package com.folk3s.echo.ui

import android.os.Build
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.DarkMode
import com.folk3s.echo.echo
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

// The app's look (v0.3, 2026-11-17): a theme preset (colours, type, shapes, a light or dark default),
// light or dark as the user chose, in Material 3's components. The ECHO theme's scheme is the M3
// content scheme of the playing album's accent, animated over 1200 ms.

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

val Inter =
  FontFamily(
    Font(R.font.inter_light, FontWeight(300)),
    Font(R.font.inter_regular, FontWeight(400)),
    Font(R.font.inter_semibold, FontWeight(600)),
    Font(R.font.inter_bold, FontWeight(700)),
    Font(R.font.inter_extrabold, FontWeight(800)),
  )

/** A theme's shapes: art, the featured card, buttons, the mini player; and whether the tab has a pill. */
data class Look(
  val art: Dp = 16.dp,
  val rowArt: Dp = 10.dp,
  val hero: Dp = 28.dp,
  val button: Dp = 26.dp,
  val mini: Dp = 22.dp,
  val circleArt: Boolean = false,
  val navPill: Boolean = true,
  val font: FontFamily = Figtree,
)

val LocalLook = staticCompositionLocalOf { Look() }

/** A page's big cover (album, playlist, Now Playing): a touch rounder than tiles, never a circle. */
val Look.page: Dp get() = if (circleArt) 16.dp else (art + 4.dp).coerceAtMost(24.dp)

/** Cards and panels that aren't art (genres, games, choices): the theme's corners, kept soft. */
val Look.panel: Dp get() = if (circleArt) 20.dp else hero.coerceAtLeast(2.dp)

/** The look of the current theme. */
val look: Look @Composable @ReadOnlyComposable get() = LocalLook.current

/**
 * The themes (v0.3, 2026-11-17): colours, shapes, type and a light or dark default each. "ECHO"
 * takes its accent from the playing album; "Material You" from the wallpaper (Android 12+).
 * The others are inspired by those services' looks; the names are labels, nothing more.
 */
enum class ThemePreset(
  val id: String,
  val label: String,
  val blurb: String,
  val accent: Color?,
  val onAccent: Color = Color.White,
  val dark: Boolean?,
  val titleWeight: Int = 800,
  val look: Look = Look(),
  val darkGround: Color? = null,
  val lightGround: Color? = null,
  val style: PaletteStyle = PaletteStyle.Fidelity,
) {
  Echo("echo", "ECHO", "Accent from the playing album", null, dark = null, style = PaletteStyle.Content),
  AppleMusic("apple", "Apple Music style", "Red, light, large bold titles", Color(0xFFFA2D48), dark = false, look = Look(art = 10.dp, rowArt = 6.dp, hero = 14.dp, button = 12.dp, mini = 14.dp, navPill = false, font = Inter), darkGround = Color(0xFF000000), lightGround = Color(0xFFFFFFFF)),
  Spotify("spotify", "Spotify style", "Green on black, square art", Color(0xFF1ED760), Color.Black, dark = true, look = Look(art = 4.dp, rowArt = 4.dp, hero = 8.dp, button = 999.dp, mini = 8.dp, navPill = false), darkGround = Color(0xFF121212), lightGround = Color(0xFFF6F6F6)),
  SoundCloud("soundcloud", "SoundCloud style", "Orange, light, flat and square", Color(0xFFFF5500), dark = false, titleWeight = 700, look = Look(art = 2.dp, rowArt = 2.dp, hero = 4.dp, button = 4.dp, mini = 4.dp, navPill = false, font = Inter), darkGround = Color(0xFF121212), lightGround = Color(0xFFF2F2F2)),
  Deezer("deezer", "Deezer style", "Purple, dark, rounded", Color(0xFFA238FF), dark = true, look = Look(art = 12.dp, rowArt = 8.dp, hero = 20.dp, button = 999.dp, mini = 16.dp), darkGround = Color(0xFF0F0D13), lightGround = Color(0xFFFAF8FF)),
  Qobuz("qobuz", "Qobuz style", "Black and white, thin editorial type", Color(0xFF3B8CFF), dark = true, titleWeight = 300, look = Look(art = 0.dp, rowArt = 0.dp, hero = 0.dp, button = 0.dp, mini = 0.dp, navPill = false, font = Inter), darkGround = Color(0xFF0B0B0C), lightGround = Color(0xFFFFFFFF)),
  Tidal("tidal", "Tidal style", "Black, white and cyan, minimal", Color(0xFF33FFEE), Color.Black, dark = true, titleWeight = 700, look = Look(art = 6.dp, rowArt = 4.dp, hero = 6.dp, button = 6.dp, mini = 6.dp, navPill = false, font = Inter), darkGround = Color(0xFF000000), lightGround = Color(0xFFFFFFFF)),
  YouTubeMusic("youtube", "YouTube Music style", "Red, dark, round art", Color(0xFFFF0033), dark = true, titleWeight = 700, look = Look(art = 999.dp, rowArt = 999.dp, hero = 16.dp, button = 999.dp, mini = 12.dp, circleArt = true), darkGround = Color(0xFF030303), lightGround = Color(0xFFFFFFFF)),
  MaterialYou("materialyou", "Material You", "Colours from your wallpaper", null, dark = null, titleWeight = 700),
  Monochrome("mono", "Monochrome", "Greys only: the art is the colour", null, dark = null, style = PaletteStyle.Monochrome);

  companion object {
    fun of(id: String) = entries.firstOrNull { it.id == id } ?: Echo
  }
}

private fun style(family: FontFamily, weight: Int, size: Int, line: Int, tracking: Double) =
  TextStyle(fontFamily = family, fontWeight = FontWeight(weight), fontSize = size.sp, lineHeight = line.sp, letterSpacing = tracking.sp)

/** The M3 type scale in the theme's face: big, tight headings at its title weight; the body as M3. */
private fun typography(f: FontFamily, t: Int) =
  Typography(
    displayLarge = style(f, t, 57, 64, -0.5),
    displayMedium = style(f, t, 45, 52, -0.5),
    displaySmall = style(f, t, 34, 40, -0.5),
    headlineLarge = style(f, t, 32, 40, -0.4),
    headlineMedium = style(f, t, 26, 32, -0.3),
    headlineSmall = style(f, (t - 50).coerceAtLeast(300), 21, 28, -0.2),
    titleLarge = style(f, (t - 100).coerceAtLeast(300), 20, 26, -0.1),
    titleMedium = style(f, 600, 16, 24, 0.15),
    titleSmall = style(f, 600, 14, 20, 0.1),
    bodyLarge = style(f, 400, 16, 24, 0.5),
    bodyMedium = style(f, 400, 14, 20, 0.25),
    bodySmall = style(f, 400, 12, 16, 0.4),
    labelLarge = style(f, 600, 14, 20, 0.1),
    labelMedium = style(f, 600, 12, 16, 0.5),
    labelSmall = style(f, 600, 11, 16, 0.5),
  )

/** A ground and its containers, a step lighter (dark) or darker (light) each. */
private fun ColorScheme.onGround(g: Color, dark: Boolean): ColorScheme {
  val to = if (dark) Color.White else Color.Black
  fun step(k: Float) = lerp(g, to, k)
  return copy(
    background = g,
    surface = g,
    surfaceDim = g,
    surfaceBright = step(0.12f),
    surfaceContainerLowest = g,
    surfaceContainerLow = step(0.03f),
    surfaceContainer = step(0.06f),
    surfaceContainerHigh = step(0.10f),
    surfaceContainerHighest = step(0.14f),
  )
}

/**
 * The app's theme: the chosen preset's colours, type and shapes, light or dark as the user set it
 * (the theme's default, the system's, or fixed). [forceDark] for Now Playing and the lyrics view,
 * which sit on the album's colours.
 */
@Composable
fun EchoTheme(forceDark: Boolean = false, content: @Composable () -> Unit) {
  val app = LocalContext.current.echo
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  val preset = ThemePreset.of(prefs.theme)
  val system = isSystemInDarkTheme()
  val dark =
    forceDark ||
      when (prefs.darkMode) {
        DarkMode.Theme -> preset.dark ?: system
        DarkMode.System -> system
        DarkMode.Light -> false
        DarkMode.Dark -> true
      }
  val typo = remember(preset) { typography(preset.look.font, preset.titleWeight) }
  val inner: @Composable () -> Unit = {
    CompositionLocalProvider(LocalLook provides preset.look, LocalContentColor provides MaterialTheme.colorScheme.onSurface, content = content)
  }
  if (preset == ThemePreset.MaterialYou && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    val ctx = LocalContext.current
    MaterialTheme(if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx), typography = typo, content = inner)
    return
  }
  DynamicMaterialTheme(
    seedColor = preset.accent ?: if (preset == ThemePreset.Monochrome) Color(0xFF808080) else stagePalette().accentColor,
    isDark = dark,
    style = preset.style,
    specVersion = ColorSpec.SpecVersion.SPEC_2025,
    typography = typo,
    animate = true,
    animationSpec = tween(1200),
  ) {
    // A brand accent stays exactly that colour, on its own ground.
    val base = MaterialTheme.colorScheme
    val accented =
      preset.accent?.let { a -> base.copy(primary = a, onPrimary = preset.onAccent, inversePrimary = a) }
        ?: if (preset == ThemePreset.Monochrome) base.copy(primary = base.onSurface, onPrimary = base.surface) else base
    val ground = if (dark) preset.darkGround else preset.lightGround
    MaterialTheme(ground?.let { accented.onGround(it, dark) } ?: accented, typography = typo, content = inner)
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
