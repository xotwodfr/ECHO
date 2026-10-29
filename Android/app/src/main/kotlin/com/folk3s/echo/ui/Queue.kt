package com.folk3s.echo.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.folk3s.echo.echo
import com.folk3s.echo.playback.PlayerState
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * A sheet in the app's own window (§9.6), so it can be glass over what it covers (a platform
 * bottom sheet is a separate window, with nothing behind it to bend). Over the Stage it is opaque
 * (DESIGN_SYSTEM.md §6): no smeared motion through it. Drag down or Back closes it.
 */
@Composable
fun Sheet(onDismiss: () -> Unit, opaque: Boolean, content: @Composable () -> Unit) {
  BackHandler(onBack = onDismiss)
  val scope = rememberCoroutineScope()
  BoxWithConstraints(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { onDismiss() } }) {
    val full = constraints.maxHeight.toFloat()
    val y = remember { Animatable(full) }
    LaunchedEffect(Unit) { y.animateTo(0f, spring(dampingRatio = 0.8f, stiffness = 380f)) }
    val drag = rememberDraggableState { d -> scope.launch { y.snapTo((y.value + d).coerceAtLeast(0f)) } }
    val shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
    CompositionLocalProvider(LocalBackdrop provides if (opaque) null else LocalBackdrop.current) {
      GlassSurface(
        if (opaque) Chamber.surface1 else MaterialTheme.colorScheme.surfaceContainerLow,
        shape,
        28.dp,
        Modifier.align(Alignment.BottomCenter).offset { IntOffset(0, y.value.roundToInt()) }.fillMaxWidth().fillMaxHeight(0.88f)
          .pointerInput(Unit) { detectTapGestures {} } // taps on the sheet stay on it
          .draggable(drag, Orientation.Vertical, onDragStopped = { v ->
            if (y.value > full * 0.15f || v > 2000f) onDismiss() else y.animateTo(0f, spring(stiffness = 380f))
          }),
      ) {
        Column(Modifier.windowInsetsPadding(WindowInsets.navigationBars)) {
          Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
            Box(Modifier.size(32.dp, 4.dp).background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f), RoundedCornerShape(2.dp)))
          }
          content()
        }
      }
    }
  }
}

/** Destructive confirmation (§9.6), in the window too, so it is glass over its 32% scrim. */
@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
  BackHandler(onBack = onDismiss)
  Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.32f)).pointerInput(Unit) { detectTapGestures { onDismiss() } }, contentAlignment = Alignment.Center) {
    GlassSurface(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(28.dp), 28.dp, Modifier.padding(24.dp).widthIn(max = 400.dp).pointerInput(Unit) { detectTapGestures {} }) {
      Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(title, style = MaterialTheme.typography.headlineSmall)
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
          TextButton(onClick = onDismiss) { Text("Cancel") }
          TextButton(onClick = onConfirm) { Text(confirm, color = MaterialTheme.colorScheme.error) }
        }
      }
    }
  }
}

/** The queue (§9.6): what plays now, Next up (added by the user), then the rest of what is playing. */
@Composable
fun QueueSheet(p: PlayerState, onClose: () -> Unit, overStage: Boolean) {
  val app = LocalContext.current.echo
  val q = p.queue
  var confirm by remember { mutableStateOf(false) }
  val upcoming = q.nextUp + q.context
  Sheet(onClose, opaque = overStage) {
    Text("Queue", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp))
    if (q.now == null) return@Sheet Empty("Nothing queued. Play an album to start.")
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
          Row(Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
            OutlinedButton(onClick = { confirm = true }) { Text("Clear queue", color = MaterialTheme.colorScheme.error) }
          }
        }
      }
      item { Box(Modifier.height(24.dp)) }
    }
  }
  if (confirm) {
    val n = upcoming.size
    ConfirmDialog(
      "Clear the queue?",
      "${if (n == 1) "The track" else "All $n tracks"} after the one playing will be removed. What is playing keeps playing.",
      "Clear queue",
      onConfirm = {
        confirm = false
        app.playback.clearUpcoming()
      },
      onDismiss = { confirm = false },
    )
  }
}
