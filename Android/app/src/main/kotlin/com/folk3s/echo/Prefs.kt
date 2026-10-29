package com.folk3s.echo

import android.content.Context
import android.provider.Settings
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.stage.Intensity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable

// Preferences (src/client/prefs.ts, SETTINGS_AND_SECURITY.md §7.1), the web's defaults. On this
// device: the server keeps only the lyric sources, which the web edits.

enum class VisualMode(val label: String) { Auto("Auto"), Reverb("Reverb"), Ambient("Ambient"), Still("Still") }

enum class Motion(val label: String) { System("System"), Full("Full"), Reduced("Reduced"), Off("Off") }

enum class Quality(val label: String) { Auto("Auto"), High("High"), Balanced("Balanced"), Low("Low"), Minimal("Minimal") }

@Serializable
data class Prefs(
  val mode: VisualMode = VisualMode.Auto,
  val intensity: Intensity = Intensity.Expressive,
  val quality: Quality = Quality.Auto,
  val motion: Motion = Motion.System,
  val backdrop: Float = 0.5f, // the Stage's blurred-cover brightness
  val lyricScale: Float = 1f,
  val lyricOffsetMs: Long = 0,
  val showUnsynced: Boolean = true,
  val scrobble: Boolean = true,
)

class PrefsStore(private val ctx: Context) {
  private val sp = ctx.getSharedPreferences("echo.prefs", Context.MODE_PRIVATE)
  private val _state = MutableStateFlow(runCatching { EchoJson.decodeFromString(Prefs.serializer(), sp.getString("prefs", null)!!) }.getOrDefault(Prefs()))
  val state: StateFlow<Prefs> = _state

  fun update(f: (Prefs) -> Prefs) {
    val next = f(_state.value)
    _state.value = next
    sp.edit().putString("prefs", EchoJson.encodeToString(Prefs.serializer(), next)).apply()
  }

  /** Reduced motion: the setting, or the system's "Remove animations" under System. */
  fun reducedMotion(p: Prefs = _state.value): Boolean =
    when (p.motion) {
      Motion.Reduced, Motion.Off -> true
      Motion.Full -> false
      Motion.System -> Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}
