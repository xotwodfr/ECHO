package com.folk3s.echo.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.echo
import com.folk3s.echo.playback.PlayerState
import com.folk3s.echo.stage.StageScreen
import kotlinx.coroutines.delay

sealed interface Route {
  data object Listen : Route
  data class Library(val tab: LibraryTab = LibraryTab.Albums) : Route
  data class Album(val id: String) : Route
  data class Artist(val id: String) : Route
  data object Search : Route
  data object Settings : Route
}

/** The back stack: the four destinations are roots; albums and artists stack on them. */
class Nav {
  val stack = mutableStateListOf<Route>(Route.Library())
  val top: Route get() = stack.last()

  fun go(r: Route) {
    stack += r
  }

  fun replace(r: Route) {
    stack[stack.lastIndex] = r
  }

  fun root(r: Route) {
    stack.clear()
    stack += r
  }

  fun back() {
    if (stack.size > 1) stack.removeAt(stack.lastIndex)
  }
}

@Composable
fun EchoRoot() {
  val app = LocalContext.current.echo
  val token by app.tokens.token.collectAsStateWithLifecycle()
  // Signed out there is no album: Sodium, and the player is not touched.
  EchoTheme(seed = if (token == null) Sodium else albumSeed()) { if (token == null) SignInScreen() else Shell() }
}

@Composable
private fun Shell() {
  val app = LocalContext.current.echo
  val nav = remember { Nav() }
  val player by app.playback.state.collectAsStateWithLifecycle()
  var queueOpen by remember { mutableStateOf(false) }
  BackHandler(enabled = nav.stack.size > 1) { nav.back() }
  val listen = nav.top == Route.Listen

  Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
    if (listen) {
      // S1 Listen: the Stage full-bleed, the dock over it; no navigation bar (§5).
      Box(Modifier.fillMaxSize()) {
        StageScreen(onClose = { nav.root(Route.Library()) })
        Box(Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.navigationBars)) {
          Dock(player, onOpenStage = {}, onQueue = { queueOpen = true }, stage = true)
        }
      }
    } else {
      Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).windowInsetsPadding(WindowInsets.statusBars)) {
          when (val r = nav.top) {
            is Route.Library -> LibraryScreen(r.tab, nav)
            is Route.Album -> AlbumScreen(r.id, nav)
            is Route.Artist -> ArtistScreen(r.id, nav)
            Route.Search -> SearchScreen(nav)
            Route.Settings -> SettingsScreen()
            Route.Listen -> {}
          }
        }
        Dock(player, onOpenStage = { nav.go(Route.Listen) }, onQueue = { queueOpen = true }, stage = false)
        NavBar(nav)
      }
    }
    player.notice?.let { msg ->
      LaunchedEffect(msg) {
        delay(4000)
        app.playback.dismissNotice()
      }
      Box(Modifier.fillMaxSize().padding(bottom = 160.dp), contentAlignment = Alignment.BottomCenter) {
        Snackbar(Modifier.padding(16.dp)) { Text(msg) }
      }
    }
  }
  if (queueOpen) QueueSheet(player, onClose = { queueOpen = false }, overStage = listen)
}

/** Below 720 dp the drawer is a navigation bar: text labels, ECHO's nav has no icons (§0). */
@Composable
private fun NavBar(nav: Nav) {
  val items = listOf("Listen" to Route.Listen, "Library" to Route.Library(), "Search" to Route.Search, "Settings" to Route.Settings)
  val current = nav.stack.first()
  Row(
    Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 8.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.SpaceEvenly,
  ) {
    for ((label, route) in items) {
      val selected = current::class == route::class
      Box(
        Modifier.clip(CircleShape)
          .background(if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
          .clickable { if (route == Route.Listen) nav.go(Route.Listen) else nav.root(route) }
          .padding(horizontal = 16.dp, vertical = 8.dp),
      ) {
        Text(
          label,
          color = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
          style = MaterialTheme.typography.labelLarge,
        )
      }
    }
  }
}

/**
 * The transport dock (§9.2), compact: progress, the cover, title and artist (to the Stage), play,
 * next and the queue. Shell in form, Stage in colour: the progress fill takes the album's accent.
 */
@Composable
fun Dock(p: PlayerState, onOpenStage: () -> Unit, onQueue: () -> Unit, stage: Boolean) {
  val app = LocalContext.current.echo
  val t = p.track
  val bg = if (stage) Color.Transparent else MaterialTheme.colorScheme.surfaceContainer
  Column(Modifier.fillMaxWidth().background(bg)) {
    Progress(p)
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      Row(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).clickable(enabled = t != null, onClick = onOpenStage), verticalAlignment = Alignment.CenterVertically) {
        Artwork(t?.cover, t?.album?.title ?: "", 48.dp)
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
          Text(t?.title ?: "Nothing playing", style = MaterialTheme.typography.bodyLarge, color = if (stage) Chamber.text else MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
          if (t != null) Text("${t.artist} – ${t.album.title}", style = MaterialTheme.typography.bodySmall, color = if (stage) Chamber.muted else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
      PlayButton(p.playing, enabled = t != null, onClick = app.playback::toggle)
      IconButton(onClick = app.playback::next, enabled = t != null && p.queue.nextUp.size + p.queue.context.size > 0, modifier = Modifier.semantics { contentDescription = "Next" }) {
        Icon(EchoIcons.next, null, tint = if (stage) Chamber.text else MaterialTheme.colorScheme.onSurface)
      }
      IconButton(onClick = onQueue, modifier = Modifier.semantics { contentDescription = "Queue" }) {
        Icon(EchoIcons.queue, null, tint = if (stage) Chamber.text else MaterialTheme.colorScheme.onSurface)
      }
    }
  }
}

/** Play/pause (§9.2): a filled circle, the glyph in the ground colour. */
@Composable
fun PlayButton(playing: Boolean, enabled: Boolean, onClick: () -> Unit, size: Int = 48) {
  Box(
    Modifier.size(size.dp).clip(CircleShape).background(if (enabled) Chamber.text else Chamber.surface3).clickable(enabled = enabled, onClick = onClick)
      .semantics { contentDescription = if (playing) "Pause" else "Play" },
    contentAlignment = Alignment.Center,
  ) {
    Icon(if (playing) EchoIcons.pause else EchoIcons.play, null, tint = Chamber.ground, modifier = Modifier.size((size / 2).dp))
  }
}

/** The progress, drawn every frame from the extrapolated position (no recomposition per frame). */
@Composable
private fun Progress(p: PlayerState) {
  val accent = albumAccent()
  var frame by remember { mutableStateOf(0L) }
  LaunchedEffect(p.playing) {
    while (p.playing) withFrameMillis { frame = it }
  }
  Box(
    Modifier.fillMaxWidth().height(3.dp).drawBehind {
      @Suppress("UNUSED_EXPRESSION") frame
      drawRect(Chamber.surface3)
      val d = p.durationMs
      if (d > 0) drawRect(accent, Offset.Zero, Size(size.width * (p.positionNow().toFloat() / d).coerceIn(0f, 1f), size.height))
    },
  )
}
