package com.folk3s.echo.stage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.Linear
import com.folk3s.echo.api.Palette
import com.folk3s.echo.api.parseCss
import com.folk3s.echo.api.toArgb
import com.folk3s.echo.echo
import java.net.URLEncoder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.json.decodeFromJsonElement

/** The Stage's palette roles (DESIGN_SYSTEM.md §3.3) as linear light; `glow` keeps its alpha. */
data class StagePalette(
  val room: Linear,
  val accent: Linear,
  val highlight: Linear,
  val glow: Linear,
  val shadow: Linear,
  val ink: Linear,
) {
  val accentColor: Color get() = Color(accent.toArgb())

  companion object {
    /** tokens.css: the achromatic fallback while nothing plays or the album has no palette. */
    val FALLBACK =
      of(Palette("oklch(0.16 0.006 250)", "#E3B26B", "oklch(0.92 0.04 80)", "oklch(0.68 0.10 75 / 0.35)", "oklch(0.08 0.004 250)", "oklch(0.95 0.006 80)"))

    fun of(p: Palette) =
      StagePalette(parseCss(p.room), parseCss(p.accent), parseCss(p.highlight), parseCss(p.glow), parseCss(p.shadow), parseCss(p.inkActive ?: "oklch(0.95 0.006 80)"))
  }
}

/** The playing album's palette (`/api/v1/palette/{albumKey}`), fetched when the album changes. */
class AlbumPalette(private val app: EchoApp) {
  private val _current = MutableStateFlow(StagePalette.FALLBACK)
  val current: StateFlow<StagePalette> = _current
  private val cache = HashMap<String, StagePalette>()

  init {
    app.scope.launch {
      app.playback.state.map { it.track?.album?.key }.distinctUntilChanged().collect { key ->
        _current.value = if (key == null) StagePalette.FALLBACK else forAlbum(key) ?: StagePalette.FALLBACK
      }
    }
  }

  /** Any album's palette (a page header's tint too); null when the server has none. */
  suspend fun forAlbum(key: String): StagePalette? {
    cache[key]?.let { return it }
    val p =
      runCatching {
          StagePalette.of(EchoJson.decodeFromJsonElement<Palette>(app.api.get("/palette/${URLEncoder.encode(key, "UTF-8")}")))
        }
        .getOrNull() ?: return null
    cache[key] = p
    return p
  }
}

@Composable
fun stagePalette(): StagePalette {
  val p by LocalContext.current.echo.palette.current.collectAsStateWithLifecycle()
  return p
}
