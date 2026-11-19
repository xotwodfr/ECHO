package com.folk3s.echo.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.echo
import com.folk3s.echo.playback.AudioMath
import com.folk3s.echo.playback.Effects
import kotlin.math.roundToInt

// Settings → Playback → Equalizer (docs/ANDROID_CLIENT.md, v0.8): on or off, the web's presets,
// and a slider per band of the phone's own equalizer. Moving a band makes the curve Custom,
// starting from the preset that was on.

private fun hzName(hz: Int) = if (hz >= 1000) "${"%.1f".format(hz / 1000f).removeSuffix(".0")} kHz" else "$hz Hz"

private fun dbName(db: Float): String {
  val r = (db * 10).roundToInt() / 10f
  val s = if (r == r.toInt().toFloat()) r.toInt().toString().removePrefix("-") else "%.1f".format(kotlin.math.abs(r))
  return when {
    r > 0 -> "+$s dB"
    r < 0 -> "−$s dB"
    else -> "0 dB"
  }
}

@Composable
fun EqualizerScreen(nav: Nav) {
  val app = LocalContext.current.echo
  val p by app.prefs.state.collectAsStateWithLifecycle()
  val info by Effects.info.collectAsStateWithLifecycle()
  val levels = Effects.levels(p, info.bands)
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
    PageBar(nav)
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      Text("Equalizer", style = MaterialTheme.typography.headlineMedium)
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("Equalizer", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(p.eqOn, { v -> app.prefs.update { it.copy(eqOn = v) } })
      }
      Text(
        if (info.available) "Shapes the sound on this phone. Boosts lower the overall level a little, so loud songs never distort."
        else "This phone's equalizer opens once something has played. Some phones don't offer one to apps.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
      )
      Text("Preset", style = MaterialTheme.typography.titleSmall)
      Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val presets = AudioMath.EQ_PRESETS.map { (id, v) -> id to v.first } + ("custom" to "Custom")
        for ((id, name) in presets)
          FilterChip(
            selected = p.eqPreset == id,
            onClick = {
              app.prefs.update {
                // Custom with nothing saved yet starts from the curve that was on.
                val keep = id == "custom" && it.eqCustom.isEmpty()
                it.copy(
                  eqPreset = id,
                  eqOn = true,
                  eqCustomHz = if (keep) info.bands else it.eqCustomHz,
                  eqCustom = if (keep) levels else it.eqCustom,
                )
              }
            },
            label = { Text(name) },
          )
      }
      Column(Modifier.alpha(if (p.eqOn) 1f else 0.6f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        info.bands.forEachIndexed { i, hz ->
          val db = levels.getOrElse(i) { 0f }
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(hzName(hz), style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(64.dp))
            Slider(
              value = db,
              onValueChange = { v ->
                val next = levels.toMutableList().also { it[i] = (v * 2).roundToInt() / 2f }
                app.prefs.update { it.copy(eqOn = true, eqPreset = "custom", eqCustomHz = info.bands, eqCustom = next) }
              },
              valueRange = info.minDb..info.maxDb,
              modifier =
                Modifier.weight(1f).semantics {
                  contentDescription = hzName(hz)
                  stateDescription = dbName(db)
                },
            )
            Spacer(Modifier.width(8.dp))
            Text(dbName(db), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(56.dp))
          }
        }
      }
      Text(
        "Moving a band switches to Custom, starting from the preset you had.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
      )
      if (p.eqPreset == "custom")
        TextButton(onClick = { app.prefs.update { it.copy(eqCustomHz = info.bands, eqCustom = info.bands.map { 0f }) } }) { Text("Flatten the custom curve") }
      Spacer(Modifier.height(160.dp))
    }
  }
}
