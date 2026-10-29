package com.folk3s.echo.stage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.api.toArgb
import com.folk3s.echo.echo
import com.folk3s.echo.ui.Artwork
import com.folk3s.echo.ui.Chamber

/** S1 Listen, the Stage (milestone 3 draws the room, the lyrics and the chrome here). */
@Composable
fun StageScreen(onClose: () -> Unit) {
  val app = LocalContext.current.echo
  val p by app.playback.state.collectAsStateWithLifecycle()
  val palette = stagePalette()
  Box(Modifier.fillMaxSize().background(Color(palette.room.toArgb())), contentAlignment = Alignment.Center) {
    val t = p.track
    if (t == null) Text("Nothing playing. Pick an album to start.", color = Chamber.muted)
    else Box(Modifier.fillMaxWidth().padding(48.dp)) { Artwork(t.cover, t.album.title, null) }
  }
}
