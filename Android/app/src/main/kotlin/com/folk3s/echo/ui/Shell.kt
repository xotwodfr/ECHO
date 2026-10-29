package com.folk3s.echo.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.api.Track
import com.folk3s.echo.echo
import com.folk3s.echo.playback.PlayerState
import com.folk3s.echo.stage.StageChrome
import com.folk3s.echo.stage.StageScreen
import com.folk3s.echo.stage.stageGlass
import kotlinx.coroutines.delay

// The app after Spotify's (docs/superpowers/specs/2026-10-29-spotify-redesign-design.md): three
// tabs (Home, Search, Your Library) in a glass bar at the bottom, a glass mini player tinted by
// the playing album floating over it, the Now Playing screen, and the lyrics view.

sealed interface Route {
  data object Home : Route
  data object Search : Route
  data object Library : Route
  data class Album(val id: String) : Route
  data class Artist(val id: String) : Route
  data class Playlist(val id: String) : Route
  data object Liked : Route
  data class Genre(val name: String) : Route
  data class Mix(val id: String) : Route
  data class Wrapped(val year: Int) : Route
  data object Settings : Route
  data object NowPlaying : Route
  data object Listen : Route
}

/** The back stack: the three tabs are roots; pages stack on them. */
class Nav {
  val stack = mutableStateListOf<Route>(Route.Home)
  val top: Route get() = stack.last()

  fun go(r: Route) {
    stack += r
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
  LaunchedEffect(token) { if (token != null) app.library.refreshCollections() }
  EchoTheme { if (token == null) SignInScreen() else Shell() }
}

@Composable
private fun Shell() {
  val app = LocalContext.current.echo
  val nav = remember { Nav() }
  val player by app.playback.state.collectAsStateWithLifecycle()
  var queueOpen by remember { mutableStateOf(false) }
  var picking by remember { mutableStateOf<List<Track>?>(null) }
  val chrome = remember { StageChrome() }
  BackHandler(enabled = nav.stack.size > 1) { nav.back() }
  val backdrop = rememberBackdrop()
  val picker = { t: Track -> picking = listOf(t) }

  Box(Modifier.fillMaxSize().background(Chamber.ground)) {
    CompositionLocalProvider(LocalBackdrop provides backdrop) {
      // The page under Now Playing and the lyrics view: the stack's top below them.
      val page = nav.stack.lastOrNull { it != Route.NowPlaying && it != Route.Listen } ?: Route.Home
      val pages = rememberSaveableStateHolder()
      val prefs by app.prefs.state.collectAsStateWithLifecycle()
      val still = app.prefs.reducedMotion(prefs)
      if (nav.top == Route.Listen)
        // The lyrics view: the room and the lyrics, the transport floating over it.
        StageScreen(
          chrome,
          onClose = { nav.back() },
          dock = {
            Box(Modifier.windowInsetsPadding(WindowInsets.navigationBars).padding(12.dp)) {
              StageDock(player, chrome, onQueue = { queueOpen = true })
            }
          },
        )
      else {
        // What the glass above it bends (§7.11): the page. A new page fades and rises in (the web's
        // View Transition), the old one fades out quickly.
        Box(Modifier.fillMaxSize().background(Chamber.surface1).backdropSource(backdrop).windowInsetsPadding(WindowInsets.statusBars)) {
          AnimatedContent(
            page,
            transitionSpec = {
              if (still) EnterTransition.None togetherWith ExitTransition.None
              else (fadeIn(tween(240, delayMillis = 60)) + slideInVertically(tween(280)) { it / 40 }) togetherWith fadeOut(tween(100))
            },
            label = "page",
          ) { r ->
            // Each page keeps its scroll position (and other saved state) for Back.
            pages.SaveableStateProvider(r.toString()) {
            when (r) {
              Route.Home -> HomeScreen(nav, onProfile = { nav.go(Route.Settings) })
              Route.Search -> SearchScreen(nav, picker)
              Route.Library -> YourLibraryScreen(nav, onProfile = { nav.go(Route.Settings) })
              is Route.Album -> AlbumScreen(r.id, nav, picker)
              is Route.Artist -> ArtistScreen(r.id, nav, picker)
              is Route.Playlist -> PlaylistScreen(r.id, nav, picker)
              Route.Liked -> LikedScreen(nav, picker)
              is Route.Genre -> GenreScreen(r.name, nav)
              is Route.Mix -> MixScreen(r.id, nav, picker)
              is Route.Wrapped -> WrappedScreen(r.year, nav)
              Route.Settings -> SettingsScreen()
              else -> {}
            }
            }
          }
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 8.dp, vertical = 8.dp)) {
          if (player.track != null) MiniPlayer(player) { nav.go(Route.NowPlaying) }
          Spacer(Modifier.height(8.dp))
          TabBar(nav)
        }
      }
      // Now Playing rises from the mini player over the page, and sinks back (Spotify's).
      AnimatedVisibility(
        nav.top == Route.NowPlaying,
        enter = if (still) EnterTransition.None else slideInVertically(spring(dampingRatio = 0.9f, stiffness = 420f)) { it } + fadeIn(tween(160)),
        exit = if (still) ExitTransition.None else slideOutVertically(tween(260)) { it } + fadeOut(tween(260)),
      ) {
        NowPlayingScreen(player, nav, onQueue = { queueOpen = true }, picker = picker)
      }
      player.notice?.let { msg ->
        LaunchedEffect(msg) {
          delay(3000)
          app.playback.dismissNotice()
        }
        Box(Modifier.fillMaxSize().padding(bottom = 160.dp), contentAlignment = Alignment.BottomCenter) {
          GlassSurface(Chamber.surface3, RoundedCornerShape(12.dp), 12.dp, Modifier.padding(16.dp)) {
            Text(msg, color = Chamber.text, modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
          }
        }
      }
      if (queueOpen) QueueSheet(player, onClose = { queueOpen = false }, overStage = nav.top == Route.Listen)
      MenuSheet(opaque = nav.top == Route.Listen)
      picking?.let { PlaylistPicker(it) { picking = null } }
    }
  }
}

/** The three tabs, Spotify's, on glass. */
@Composable
private fun TabBar(nav: Nav) {
  val tabs = listOf(Triple("Home", Route.Home, EchoIcons.home), Triple("Search", Route.Search, EchoIcons.search), Triple("Your Library", Route.Library, EchoIcons.library))
  val root = nav.stack.first()
  GlassSurface(Chamber.surface2, CircleShape, 32.dp, Modifier.fillMaxWidth().height(64.dp)) {
    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
      for ((label, route, icon) in tabs) {
        val on = root == route
        Column(
          Modifier.clip(RoundedCornerShape(16.dp)).clickable { nav.root(route) }.padding(horizontal = 16.dp, vertical = 6.dp)
            .semantics { contentDescription = label },
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          Icon(if (on && route == Route.Home) EchoIcons.homeFilled else icon, null, tint = if (on) Chamber.text else Chamber.muted, modifier = Modifier.size(24.dp))
          Text(label, color = if (on) Chamber.text else Chamber.muted, style = MaterialTheme.typography.labelSmall)
        }
      }
    }
  }
}

/** Spotify's mini player: the playing album's tone under glass, a hairline of progress. */
@Composable
private fun MiniPlayer(p: PlayerState, onOpen: () -> Unit) {
  val app = LocalContext.current.echo
  val t = p.track ?: return
  val tint = headerTone(albumAccent())
  GlassSurface(tint, RoundedCornerShape(10.dp), 10.dp, Modifier.fillMaxWidth().height(56.dp)) {
    Box(Modifier.fillMaxSize()) {
      Row(Modifier.fillMaxSize().clickable(onClick = onOpen).padding(start = 8.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Artwork(t.cover, t.album.title, 40.dp)
        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
          Text(t.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          Text(t.artist, color = Chamber.text.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Heart(t, 22)
        Box(
          Modifier.size(44.dp).clip(CircleShape).clickable(onClick = app.playback::toggle).semantics { contentDescription = if (p.playing) "Pause" else "Play" },
          contentAlignment = Alignment.Center,
        ) { Icon(if (p.playing) EchoIcons.pause else EchoIcons.play, null, tint = Chamber.text, modifier = Modifier.size(24.dp)) }
      }
      Progress(p, Modifier.align(Alignment.BottomCenter).padding(horizontal = 8.dp))
    }
  }
}

/** The progress, drawn every frame from the extrapolated position (no recomposition per frame). */
@Composable
fun Progress(p: PlayerState, modifier: Modifier = Modifier, height: Int = 2, track: Color = Chamber.text.copy(alpha = 0.25f), fill: Color = Chamber.text) {
  var frame by remember { mutableStateOf(0L) }
  LaunchedEffect(p.playing) {
    while (p.playing) withFrameMillis { frame = it }
  }
  Box(
    modifier.fillMaxWidth().height(height.dp).drawBehind {
      @Suppress("UNUSED_EXPRESSION") frame
      drawRect(track)
      val d = p.durationMs
      if (d > 0) drawRect(fill, Offset.Zero, Size(size.width * (p.positionNow().toFloat() / d).coerceIn(0f, 1f), size.height))
    },
  )
}

/** The transport over the lyrics view: a glass pill that fades with the chrome. */
@Composable
private fun StageDock(p: PlayerState, chrome: StageChrome, onQueue: () -> Unit) {
  val app = LocalContext.current.echo
  val shown = chrome.visible
  val alpha by animateFloatAsState(if (shown) 1f else 0f, tween(if (shown) 160 else 640), label = "dock")
  val density = LocalDensity.current.density
  Row(
    Modifier.fillMaxWidth().height(64.dp).alpha(alpha).clip(CircleShape).background(Chamber.ground.copy(alpha = 0.35f))
      .stageGlass(chrome, "dock", { _, h -> h / 2 }, density).padding(horizontal = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    IconBtn(EchoIcons.previous, "Previous", Chamber.text, 24) { app.playback.previous() }
    PlayButton(p.playing, enabled = p.track != null, onClick = app.playback::toggle, size = 44)
    IconBtn(EchoIcons.next, "Next", Chamber.text, 24) { app.playback.next() }
    Box(Modifier.weight(1f).padding(horizontal = 8.dp)) { Progress(p, height = 3) }
    IconBtn(EchoIcons.queue, "Queue", Chamber.text, 22, onQueue)
  }
}

/** Play/pause: Spotify's white disc, the glyph in black. */
@Composable
fun PlayButton(playing: Boolean, enabled: Boolean, onClick: () -> Unit, size: Int = 48) {
  Box(
    Modifier.size(size.dp).clip(CircleShape).background(if (enabled) Chamber.text else Chamber.surface3).clickable(enabled = enabled, onClick = onClick)
      .semantics { contentDescription = if (playing) "Pause" else "Play" },
    contentAlignment = Alignment.Center,
  ) {
    Icon(if (playing) EchoIcons.pause else EchoIcons.play, null, tint = Chamber.ground, modifier = Modifier.size((size * 0.45f).dp))
  }
}
