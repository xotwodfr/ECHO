package com.folk3s.echo.ui

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
    Spacer(Modifier.padding(24.dp))
  }
}
