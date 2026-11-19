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

/** Light or dark: the theme's own default, the system's, or fixed. */
enum class DarkMode(val label: String) { Theme("Theme default"), System("System"), Light("Light"), Dark("Dark") }

/** How the lyrics look (v0.3; the styles are drawn in stage/lyrics/Styled.kt and LyricsField.kt). */
enum class LyricStyle(val label: String, val blurb: String) {
  Apple("Apple Music style", "Big bold lines that fill word by word; the rest dim and blur."),
  Spicy("Spicy Lyrics style", "Sung words glow and lift; the word being sung swells."),
  Cinema("Cinema", "Centred and full screen, three lines at a time."),
  ColourBlock("Colour block", "A solid album-coloured card, line by line, no blur."),
  Kinetic("Kinetic", "One huge line at a time; words pop in as they're sung."),
  Clay("Clay", "Sung words puff up out of the clay; the rest are stamped into it."),
  Embroidered("Embroidered", "Words traced on a hoop, stitched in thread as they're sung."),
  Glass("Glass", "The line being sung in a moving glass lens; the rest frosted behind."),
  CutOut("Cut-out", "A notebook page; sung words cut out of coloured paper and stuck on, crooked."),
  Display("Display", "A glowing teal hi-fi display; sung letters light up."),
  Karaoke("Karaoke", "Two centred lines; the sung part changes colour."),
  Classic("ECHO classic", "ECHO's own: glow, depth and duets over the visualizer."),
}

/** Clay's deep colours for the dark (v0.4): id, name, and the clay's main colour. */
val CLAY_DARK = listOf(
  Triple("red", "Dark red", 0xFFC4525E),
  Triple("navy", "Navy", 0xFF5C7BD1),
  Triple("aubergine", "Aubergine", 0xFF9B6FC4),
  Triple("forest", "Forest", 0xFF5AA77B),
  Triple("teal", "Teal", 0xFF4FB3B0),
  Triple("rust", "Rust", 0xFFD07A4F),
  Triple("plum", "Plum", 0xFFC26AA2),
  Triple("charcoal", "Charcoal", 0xFFA49FAE),
)

/** The bottom tabs, in their default order; the user can reorder them in Settings. */
val DEFAULT_TABS = listOf("home", "mixes", "games", "library", "search")

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
  val tabs: List<String> = DEFAULT_TABS,
  val theme: String = "echo",
  val darkMode: DarkMode = DarkMode.Theme,
  val lyricStyle: LyricStyle = LyricStyle.Apple,
  val lyricVisualizer: Boolean = false,
  val haptics: Boolean = true,
  /** Clay in the dark: "album" (a deep shade of what's playing) or one of [CLAY_DARK]'s ids. */
  val clayDark: String = "album",
  /** Squishes and needle clicks on presses in the Clay and Yarn themes. */
  val themeSounds: Boolean = true,
  /** Karaoke mode (docs/KARAOKE.md): the server's karaoke version of each song, when it has one. */
  val karaoke: Boolean = false,
  /** How much of the voice Karaoke mode leaves, 0 to 1. */
  val vocalLevel: Float = 0f,
  /** Karaoke's key in semitones, −6 to 6: kept while Karaoke is off, applied only while it's on. */
  val karaokeKey: Int = 0,
  /** Crossfade between songs in seconds, 0 (off) to 12; never within an album (playback/Crossfader.kt). */
  val crossfadeSec: Int = 0,
  /** The equalizer: on or off, a preset id (playback/AudioMath.kt), and the custom curve as points. */
  val eqOn: Boolean = false,
  val eqPreset: String = "flat",
  val eqCustomHz: List<Int> = emptyList(),
  val eqCustom: List<Float> = emptyList(),
) {
  /** The tabs in the user's order: every known tab once, whatever an older save holds. */
  val tabOrder: List<String> get() = (tabs.filter { it in DEFAULT_TABS } + DEFAULT_TABS).distinct()
}

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
