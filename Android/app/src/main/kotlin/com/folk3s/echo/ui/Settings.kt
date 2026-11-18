package com.folk3s.echo.ui

import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.width
import androidx.compose.material3.RadioButton
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.selected
import com.folk3s.echo.DarkMode
import com.folk3s.echo.LyricStyle
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.BuildConfig
import com.folk3s.echo.Motion
import com.folk3s.echo.Prefs
import com.folk3s.echo.Quality
import com.folk3s.echo.VisualMode
import com.folk3s.echo.echo
import com.folk3s.echo.stage.Intensity
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Settings (S7; SETTINGS_AND_SECURITY.md §7.1): the web's preferences that matter on a phone, kept
// on this device, the account, and signing this device out. The rest (connections, two-factor,
// sessions, admin) stays on the web.

private val SIZES = listOf(0.85f to "Small", 1f to "Default", 1.15f to "Large", 1.3f to "Largest")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> Choice(label: String, hint: String? = null, options: List<Pair<T, String>>, value: T, onPick: (T) -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Text(label, style = MaterialTheme.typography.titleSmall)
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
      options.forEachIndexed { i, (v, name) ->
        SegmentedButton(selected = v == value, onClick = { onPick(v) }, shape = SegmentedButtonDefaults.itemShape(i, options.size), label = { Text(name, maxLines = 1) })
      }
    }
    if (hint != null) Text(hint, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
  }
}

@Composable
private fun Toggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
    Switch(value, onChange)
  }
}

@Composable
private fun Section(title: String) {
  Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
}

@Composable
fun SettingsScreen() {
  val app = LocalContext.current.echo
  val scope = rememberCoroutineScope()
  val p by app.prefs.state.collectAsStateWithLifecycle()
  fun set(f: (Prefs) -> Prefs) = app.prefs.update(f)
  var who by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(Unit) {
    who =
      runCatching {
          val me = app.api.get("/me").jsonObject
          val name = me["username"]?.jsonPrimitive?.contentOrNull ?: ""
          "Signed in as $name${if (me["role"]?.jsonPrimitive?.contentOrNull == "admin") " (admin)" else ""}"
        }
        .getOrNull()
  }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
    Text("Settings", style = MaterialTheme.typography.headlineMedium)

    Section("Appearance")
    Text("Theme", style = MaterialTheme.typography.titleSmall)
    // Clay and Yarn bring their own lyrics; the style can still be changed after.
    ThemePicker(p.theme) { id ->
      set {
        it.copy(
          theme = id,
          lyricStyle = when (id) {
            "clay" -> LyricStyle.Clay
            "yarn" -> LyricStyle.Embroidered
            else -> it.lyricStyle
          },
        )
      }
    }
    Choice("Light or dark", "Theme default: each theme's own (Spotify style is dark, Apple Music style light, ECHO follows the system).", DarkMode.entries.map { it to (if (it == DarkMode.Theme) "Theme" else it.label) }, p.darkMode) { v -> set { it.copy(darkMode = v) } }
    if (p.theme == "clay") ClayDarkPicker(p.clayDark) { v -> set { it.copy(clayDark = v) } }
    Toggle("Haptics (light taps on presses, likes and answers)", p.haptics) { v -> set { it.copy(haptics = v) } }
    if (p.theme == "clay" || p.theme == "yarn") Toggle(if (p.theme == "clay") "Clay sounds (squishes and pops on presses)" else "Yarn sounds (soft thumps and needle clicks)", p.themeSounds) { v -> set { it.copy(themeSounds = v) } }

    Section("Tabs")
    Text("The order of the tabs at the bottom. The first one opens when ECHO starts.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    val order = p.tabOrder
    Column(Modifier.clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainer)) {
      order.forEachIndexed { i, id ->
        val (label, icon) = tabInfo(id)
        Row(Modifier.fillMaxWidth().height(56.dp).padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
          Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f).padding(start = 14.dp))
          fun move(to: Int) = set { it.copy(tabs = order.toMutableList().apply { add(to, removeAt(i)) }) }
          IconButton(onClick = { move(i - 1) }, enabled = i > 0, modifier = Modifier.semantics { contentDescription = "Move $label up" }) { Icon(EchoIcons.chevronUp, null) }
          IconButton(onClick = { move(i + 1) }, enabled = i < order.lastIndex, modifier = Modifier.semantics { contentDescription = "Move $label down" }) { Icon(EchoIcons.chevronDown, null) }
        }
      }
    }
    if (order != com.folk3s.echo.DEFAULT_TABS) TextButton(onClick = { set { it.copy(tabs = com.folk3s.echo.DEFAULT_TABS) } }) { Text("Reset to default order") }

    Section("Visuals")
    Choice("Stage visuals", "Reverb follows the music where ECHO can hear it.", VisualMode.entries.map { it to it.label }, p.mode) { v -> set { it.copy(mode = v) } }
    Choice("Reverb intensity", null, Intensity.entries.map { it to it.name }, p.intensity) { v -> set { it.copy(intensity = v) } }
    Choice("Motion", "System follows Remove animations in the accessibility settings.", Motion.entries.map { it to it.label }, p.motion) { v -> set { it.copy(motion = v) } }
    Choice("Visual quality", "This device only. Applies the next time the Stage opens.", Quality.entries.map { it to it.label }, p.quality) { v -> set { it.copy(quality = v) } }
    Column {
      Text("Background brightness", style = MaterialTheme.typography.titleSmall)
      Slider(p.backdrop, { v -> set { it.copy(backdrop = v) } }, Modifier.semantics { contentDescription = "Background brightness" })
    }

    Section("Lyrics")
    Text("Style", style = MaterialTheme.typography.titleSmall)
    Column(Modifier.clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainer)) {
      for (st in LyricStyle.entries)
        Row(Modifier.fillMaxWidth().clickable { set { it.copy(lyricStyle = st) } }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
          RadioButton(selected = p.lyricStyle == st, onClick = null)
          Column(Modifier.padding(start = 12.dp)) {
            Text(st.label, style = MaterialTheme.typography.bodyLarge)
            Text(st.blurb, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
          }
        }
    }
    Toggle("Visualizer behind the lyrics", p.lyricVisualizer) { v -> set { it.copy(lyricVisualizer = v) } }
    Text("Off: the album's colours drift slowly behind the lyrics, easier on the battery. ECHO classic always has the visualizer.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    Choice("Lyric size", null, SIZES, p.lyricScale) { v -> set { it.copy(lyricScale = v) } }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text("Timing offset for all tracks", style = MaterialTheme.typography.titleSmall)
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { set { it.copy(lyricOffsetMs = (it.lyricOffsetMs - 50).coerceAtLeast(-5000)) } }) { Text("−50 ms") }
        val o = p.lyricOffsetMs
        Text(if (o == 0L) "0 ms" else "${if (o > 0) "+" else "−"}${kotlin.math.abs(o)} ms", modifier = Modifier.padding(horizontal = 8.dp))
        OutlinedButton(onClick = { set { it.copy(lyricOffsetMs = (it.lyricOffsetMs + 50).coerceAtMost(5000)) } }) { Text("+50 ms") }
      }
      Text("Positive shows words later.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
    Toggle("Show lyrics without timing", p.showUnsynced) { v -> set { it.copy(showUnsynced = v) } }

    Section("Playback")
    Toggle("Scrobble plays to Navidrome", p.scrobble) { v -> set { it.copy(scrobble = v) } }

    Section("Account")
    Text(who ?: app.api.base.substringAfter("://"), color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text("Connections, two-factor sign-in and devices are managed on the web.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    OutlinedButton(onClick = { scope.launch { app.api.signOut() } }) { Text("Sign out") }

    Section("About")
    Text(
      "ECHO ${BuildConfig.VERSION_NAME} for Android — free software under the AGPL-3.0. Mona Sans and Roboto Flex under the SIL Open Font License. Lyrics come from your library, Spicy Lyrics, NetEase Cloud Music and LRCLIB, credited on the Stage.",
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      style = MaterialTheme.typography.bodySmall,
    )
    Spacer(Modifier.height(160.dp))
  }
}

/** The themes as swatch cards: each one's ground, accent and art shape. */
@Composable
private fun ThemePicker(current: String, onPick: (String) -> Unit) {
  val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
  Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
    for (t in ThemePreset.entries) {
      val on = t.id == current
      val dark = t.dark ?: systemDark
      val ground = (if (dark) t.darkGround else t.lightGround) ?: if (dark) Color(0xFF16141A) else Color(0xFFF6F4F8)
      val ink = if (dark) Color.White else Color(0xFF16141A)
      val accent = t.accent ?: when (t) {
        ThemePreset.Monochrome -> ink
        ThemePreset.MaterialYou -> MaterialTheme.colorScheme.primary
        else -> albumAccent()
      }
      Column(
        Modifier.width(112.dp).bouncy(label = t.label) { onPick(t.id) }.semantics { selected = on },
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Box(
          Modifier.size(112.dp, 140.dp).clip(RoundedCornerShape(18.dp)).background(ground)
            .border(if (on) 3.dp else 1.dp, if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(18.dp))
            .padding(12.dp),
        ) {
          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Aa", color = ink, style = MaterialTheme.typography.titleLarge.copy(fontFamily = t.look.font, fontWeight = androidx.compose.ui.text.font.FontWeight(t.titleWeight)))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              for (c in listOf(Color(0xFFFF6B6B), Color(0xFF6B8CFF))) Box(Modifier.size(34.dp).clip(RoundedCornerShape(if (t.look.circleArt) 17.dp else t.look.rowArt.coerceAtMost(12.dp))).background(c))
            }
            Box(Modifier.size(56.dp, 20.dp).clip(RoundedCornerShape(t.look.button.coerceAtMost(10.dp))).background(accent))
          }
        }
        Text(t.label, style = MaterialTheme.typography.labelMedium, maxLines = 2, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
      }
    }
  }
}

/** Clay in the dark: a deep shade of the album that's playing, or one fixed colour. */
@Composable
private fun ClayDarkPicker(value: String, onPick: (String) -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Text("Clay in the dark", style = MaterialTheme.typography.titleSmall)
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
      SegmentedButton(selected = value == "album", onClick = { onPick("album") }, shape = SegmentedButtonDefaults.itemShape(0, 2), label = { Text("From the album") })
      SegmentedButton(selected = value != "album", onClick = { if (value == "album") onPick(com.folk3s.echo.CLAY_DARK.first().first) }, shape = SegmentedButtonDefaults.itemShape(1, 2), label = { Text("Pick a colour") })
    }
    if (value == "album")
      Text("A deep shade of what's playing, changing with each song.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    else
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        for ((id, name, argb) in com.folk3s.echo.CLAY_DARK) {
          val on = id == value
          Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(64.dp).bouncy(label = name) { onPick(id) }.semantics { selected = on }) {
            Box(
              Modifier.size(48.dp).border(if (on) 3.dp else 0.dp, if (on) MaterialTheme.colorScheme.primary else Color.Transparent, androidx.compose.foundation.shape.CircleShape).padding(4.dp)
                .clip(androidx.compose.foundation.shape.CircleShape).background(Brush.radialGradient(listOf(Color(argb).copy(alpha = 1f).let { androidx.compose.ui.graphics.lerp(it, Color.White, 0.3f) }, Color(argb), androidx.compose.ui.graphics.lerp(Color(argb), Color.Black, 0.35f)), androidx.compose.ui.geometry.Offset(30f, 26f), 90f)),
            )
            Text(name, style = MaterialTheme.typography.labelSmall, maxLines = 1, modifier = Modifier.padding(top = 4.dp))
          }
        }
      }
  }
}
