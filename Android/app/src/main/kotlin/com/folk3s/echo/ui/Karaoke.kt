package com.folk3s.echo.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.echo
import com.folk3s.echo.playback.KaraokeState
import com.folk3s.echo.playback.KaraokeStatus

// Karaoke mode's controls (docs/KARAOKE.md): the vocals slider, under Now Playing's pills and over
// the lyrics view's dock, and a line saying where the karaoke version is.

/** What to tell the listener; null when nothing needs saying (it is ready and playing). */
fun karaokeNote(s: KaraokeState): String? =
  when (s.status) {
    KaraokeStatus.Off, KaraokeStatus.Ready -> null
    KaraokeStatus.Unavailable ->
      if (s.server == false) "Karaoke needs the stem service on your ECHO server (docs/KARAOKE.md)."
      else "Karaoke works with songs from your library."
    KaraokeStatus.Preparing ->
      when (s.ahead) {
        0 -> "Preparing the karaoke version… it starts by itself when it's ready."
        1 -> "Preparing the karaoke version… 1 song before this one."
        else -> "Preparing the karaoke version… ${s.ahead} songs before this one."
      }
    KaraokeStatus.Failed -> "The voice couldn't be taken out of this song."
    KaraokeStatus.TooLong -> "This song is too long for Karaoke."
    KaraokeStatus.Downmixed -> "This phone mixes 5.1 audio down to stereo, so the voice stays in."
  }

/** The vocals slider: 0 % is the instrumental, 100 % the song as recorded. */
@Composable
fun VocalsSlider(tint: Color, modifier: Modifier = Modifier, showNote: Boolean = true) {
  val app = LocalContext.current.echo
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  val state by app.karaoke.state.collectAsStateWithLifecycle()
  if (!prefs.karaoke) return
  Column(modifier.fillMaxWidth()) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Icon(EchoIcons.mic, null, tint = tint.copy(alpha = 0.7f), modifier = Modifier.size(18.dp))
      Spacer(Modifier.width(10.dp))
      Slider(
        value = prefs.vocalLevel,
        onValueChange = app.karaoke::setLevel,
        modifier =
          Modifier.weight(1f).semantics {
            contentDescription = "Vocals"
            stateDescription = "${(prefs.vocalLevel * 100).toInt()} percent"
          },
        colors =
          SliderDefaults.colors(
            thumbColor = tint,
            activeTrackColor = tint,
            inactiveTrackColor = tint.copy(alpha = 0.22f),
          ),
      )
      Spacer(Modifier.width(10.dp))
      Text("${(prefs.vocalLevel * 100).toInt()}%", color = tint.copy(alpha = 0.8f), style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(40.dp))
    }
    val note = if (showNote) karaokeNote(state) else null
    if (note != null)
      Text(note, color = tint.copy(alpha = 0.65f), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 28.dp, top = 2.dp))
  }
}
