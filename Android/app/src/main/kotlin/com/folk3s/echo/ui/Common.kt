package com.folk3s.echo.ui

import kotlin.math.abs

import androidx.compose.ui.input.pointer.pointerInput

import androidx.compose.runtime.rememberUpdatedState

import androidx.compose.foundation.gestures.detectDragGestures

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.SubcomposeAsyncImage
import com.folk3s.echo.api.Track
import com.folk3s.echo.echo

fun duration(ms: Long): String {
  val s = (ms / 1000).coerceAtLeast(0)
  return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

/**
 * Cover art at its own aspect, never cropped (DESIGN_SYSTEM.md §8): radius 4 at row sizes, 12 in
 * tiles. Missing or broken art: the title in the ECHO face on a plain square, no placeholder icon.
 */
@Composable
fun Artwork(path: String?, title: String, size: Dp?, modifier: Modifier = Modifier, radius: Dp = if ((size ?: 999.dp) <= 64.dp) 4.dp else 12.dp) {
  val api = LocalContext.current.echo.api
  val shape = RoundedCornerShape(radius)
  val box = (if (size != null) modifier.size(size) else modifier.fillMaxWidth().aspectRatio(1f)).clip(shape)
  val fallback =
    @Composable {
      Box(box.background(Chamber.surface2).padding(8.dp)) {
        Text(
          title,
          color = Chamber.muted,
          fontFamily = Figtree,
          fontWeight = FontWeight.SemiBold,
          fontSize = ((size ?: 168.dp).value * 0.18f).coerceIn(8f, 40f).sp,
          lineHeight = ((size ?: 168.dp).value * 0.2f).coerceIn(9f, 44f).sp,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  if (path == null) return fallback()
  SubcomposeAsyncImage(
    model = api.url(path),
    contentDescription = null,
    contentScale = ContentScale.Fit,
    modifier = box,
    error = { fallback() },
    loading = { Box(box.background(Chamber.surface2)) },
  )
}

/** A track row (§9.3): a play target; now playing is marked beyond colour, by the bars. */
@Composable
fun TrackRow(
  track: Track,
  index: Int?,
  nowPlaying: Boolean,
  onPlay: () -> Unit,
  showArt: Boolean = false,
  menu: List<Pair<String, () -> Unit>> = emptyList(),
) {
  val color = if (nowPlaying) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
  Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onPlay).padding(horizontal = 8.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    when {
      showArt -> Artwork(track.cover, track.album.title, 40.dp)
      index != null ->
        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) {
          if (nowPlaying) NowPlayingBars() else Text("$index", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        }
    }
    Column(Modifier.weight(1f)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        if (nowPlaying && showArt) {
          NowPlayingBars()
          Spacer(Modifier.width(6.dp))
        }
        Text(track.title, color = color, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      Text(track.artist, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (track.durationMs > 0) Text(duration(track.durationMs), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    if (menu.isNotEmpty()) MoreMenu("More for ${track.title}", menu)
  }
}

/** The open "…" menu, one at a time: the Shell shows it as a bottom sheet (Spotify's), not a popup. */
object Menus {
  var open by mutableStateOf<Pair<String, List<Pair<String, () -> Unit>>>?>(null)
}

@Composable
fun MoreMenu(label: String, items: List<Pair<String, () -> Unit>>) {
  IconButton(onClick = { Menus.open = label to items }, modifier = Modifier.semantics { contentDescription = label }) {
    Icon(EchoIcons.more, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

/** The menu as an M3 bottom sheet over the screen; a choice closes it first. */
@Composable
fun MenuSheet() {
  val (label, items) = Menus.open ?: return
  Sheet({ Menus.open = null }, fit = true) {
    Column(Modifier.padding(bottom = 16.dp)) {
      Text(label.removePrefix("More for "), style = MaterialTheme.typography.titleMedium, maxLines = 1, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
      for ((text, action) in items)
        Text(
          text,
          style = MaterialTheme.typography.bodyLarge,
          modifier = Modifier.fillMaxWidth().clickable {
            Menus.open = null
            action()
          }.padding(horizontal = 24.dp, vertical = 16.dp),
        )
    }
  }
}

/** The three-bar playing glyph (static: the Shell performs no motion of its own). */
@Composable
fun NowPlayingBars() {
  val c = MaterialTheme.colorScheme.primary
  Row(Modifier.height(12.dp).semantics { contentDescription = "Now playing" }, horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
    for (h in listOf(8, 12, 6)) Box(Modifier.width(3.dp).height(h.dp).background(c, RoundedCornerShape(1.dp)))
  }
}

@Composable
fun Loading(modifier: Modifier = Modifier) {
  Box(modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
fun BlockError(what: String, onRetry: (() -> Unit)?) {
  Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.Start, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Icon(EchoIcons.alert, null, tint = MaterialTheme.colorScheme.error)
      Text(what, color = MaterialTheme.colorScheme.onSurface)
    }
    if (onRetry != null) OutlinedButton(onClick = onRetry) { Text("Retry") }
  }
}

@Composable
fun Empty(text: String) {
  Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
}

@Composable
fun CenterBox(content: @Composable () -> Unit) {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}

@Composable
fun SectionLabel(text: String) {
  Text(text, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp, top = 16.dp, bottom = 8.dp))
}

/**
 * Spotify's swipes: a drag past 48 dp along its main direction, on release. Taps stay clicks, and
 * controls inside (a seek bar) keep their own drags.
 */
@Composable
fun Modifier.swipes(left: (() -> Unit)? = null, right: (() -> Unit)? = null, up: (() -> Unit)? = null, down: (() -> Unit)? = null): Modifier {
  val l by rememberUpdatedState(left)
  val r by rememberUpdatedState(right)
  val u by rememberUpdatedState(up)
  val d by rememberUpdatedState(down)
  return pointerInput(Unit) {
    val far = 48.dp.toPx()
    var dx = 0f
    var dy = 0f
    detectDragGestures(
      onDragStart = {
        dx = 0f
        dy = 0f
      },
      onDragEnd = {
        if (abs(dx) > abs(dy)) (if (dx < -far) l else if (dx > far) r else null)?.invoke()
        else (if (dy < -far) u else if (dy > far) d else null)?.invoke()
      },
    ) { change, drag ->
      change.consume()
      dx += drag.x
      dy += drag.y
    }
  }
}
