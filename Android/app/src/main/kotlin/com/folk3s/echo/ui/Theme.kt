package com.folk3s.echo.ui

import androidx.compose.animation.core.tween
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.echo
import com.folk3s.echo.stage.stagePalette
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import com.folk3s.echo.R
import com.materialkolor.DynamicMaterialTheme
import com.materialkolor.PaletteStyle
import com.materialkolor.dynamiccolor.ColorSpec

// The two zones (DESIGN_SYSTEM.md §0–§1): the Shell is Material 3 with the playing album's accent
// as the seed (SchemeContent, spec 2025, dark), animated over 1200 ms like the web's palette; the
// Stage keeps Reverb Chamber's neutrals (tokens.css) and Mona Sans.

/** Sodium: the seed while nothing plays (DESIGN_SYSTEM.md §2). */
val Sodium = Color(0xFFE3B26B)

/** Reverb Chamber (tokens.css, the player view). */
object Chamber {
  val ground = Color(0xFF0A0B0D)
  val surface1 = Color(0xFF131417)
  val surface2 = Color(0xFF1C1E22)
  val surface3 = Color(0xFF272A2F)
  val line = Color(0xFF202226)
  val control = Color(0xFF666A71)
  val text = Color(0xFFF2F1EE)
  val muted = Color(0xFFB3B5B9)
  val faint = Color(0xFF94979C)
}

private fun variable(res: Int, vararg weights: Int) =
  FontFamily(weights.map { w -> Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))) })

/** The Shell's face (DESIGN_SYSTEM.md §0). */
val RobotoFlex = variable(R.font.roboto_flex, 400, 500, 600, 700)

/** The Stage's face (DESIGN_SYSTEM.md §4.1); the lyric field sets its own width axis. */
val MonaSans = variable(R.font.mona_sans, 400, 500, 600, 700)

private fun TextStyle.face() = copy(fontFamily = RobotoFlex)

private val EchoTypography =
  Typography().run {
    Typography(
      displayLarge.face(), displayMedium.face(), displaySmall.face(),
      headlineLarge.face(), headlineMedium.face(), headlineSmall.face(),
      titleLarge.face(), titleMedium.face(), titleSmall.face(),
      bodyLarge.face(), bodyMedium.face(), bodySmall.face(),
      labelLarge.face(), labelMedium.face(), labelSmall.face(),
    )
  }

@Composable
fun EchoTheme(seed: Color = Sodium, content: @Composable () -> Unit) {
  DynamicMaterialTheme(
    seedColor = seed,
    isDark = true,
    style = PaletteStyle.Content,
    specVersion = ColorSpec.SpecVersion.SPEC_2025,
    typography = EchoTypography,
    animate = true,
    animationSpec = tween(1200),
    content = content,
  )
}

/** The Shell's seed: the playing album's accent, Sodium while nothing plays (§0). */
@Composable
fun albumSeed(): Color {
  val playing by LocalContext.current.echo.playback.state.collectAsStateWithLifecycle()
  return if (playing.track != null) stagePalette().accentColor else Sodium
}

/** `--art-accent`: the progress fill and the playing marks take the album's colour (§1). */
@Composable
fun albumAccent(): Color = stagePalette().accentColor
