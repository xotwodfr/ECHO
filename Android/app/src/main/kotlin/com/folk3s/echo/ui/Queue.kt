package com.folk3s.echo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.folk3s.echo.echo
import com.folk3s.echo.playback.PlayerState

/**
 * The queue sheet (§9.6): what plays now, Next up (added by the user), then the rest of what is
 * playing. Over the Stage it is opaque (DESIGN_SYSTEM.md §6); over the Shell it is glass (§7.11).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QueueSheet(p: PlayerState, onClose: () -> Unit, overStage: Boolean) {
  val app = LocalContext.current.echo
  val q = p.queue
  var confirm by remember { mutableStateOf(false) }
  val upcoming = q.nextUp + q.context
  ModalBottomSheet(
    onDismissRequest = onClose,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = if (overStage) Chamber.surface1 else MaterialTheme.colorScheme.surfaceContainerLow,
  ) {
    Text("Queue", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp))
    if (q.now == null) return@ModalBottomSheet Empty("Nothing queued. Play an album to start.")
    LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
      item { SectionLabel("Now playing") }
      item { TrackRow(q.now, null, true, {}, showArt = true) }
      if (q.nextUp.isNotEmpty()) item { SectionLabel("Next up") }
      itemsIndexed(upcoming) { i, t ->
        if (i == q.nextUp.size && q.context.isNotEmpty()) SectionLabel(q.source?.let { "Then, from ${it.title}" } ?: "Then")
        val menu =
          buildList {
            if (i > 0) add("Move up" to { app.playback.moveUpcoming(i, i - 1) })
            if (i < upcoming.lastIndex) add("Move down" to { app.playback.moveUpcoming(i, i + 1) })
            add("Remove" to { app.playback.removeUpcoming(i) })
          }
        TrackRow(t, null, false, { app.playback.jumpTo(i) }, showArt = true, menu = menu)
      }
      if (upcoming.isNotEmpty()) {
        item {
          Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalArrangement = Arrangement.Start) {
            OutlinedButton(onClick = { confirm = true }) { Text("Clear queue", color = MaterialTheme.colorScheme.error) }
          }
        }
      }
    }
  }
  if (confirm) {
    val n = upcoming.size
    AlertDialog(
      onDismissRequest = { confirm = false },
      title = { Text("Clear the queue?") },
      text = { Text("${if (n == 1) "The track" else "All $n tracks"} after the one playing will be removed. What is playing keeps playing.") },
      dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
      confirmButton = {
        TextButton(onClick = {
          confirm = false
          app.playback.clearUpcoming()
        }) { Text("Clear queue", color = MaterialTheme.colorScheme.error) }
      },
    )
  }
}
