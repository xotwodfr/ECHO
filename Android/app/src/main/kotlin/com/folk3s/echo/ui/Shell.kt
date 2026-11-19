package com.folk3s.echo.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationBarDefaults
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.IntOffset
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.hazeSource
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
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.api.Track
import com.folk3s.echo.games.GameKind
import com.folk3s.echo.echo
import com.folk3s.echo.playback.PlayerState
import com.folk3s.echo.stage.StageChrome
import com.folk3s.echo.stage.StageScreen
import kotlinx.coroutines.delay

// The app's frame (v0.2, 2026-11-17): five tabs (Home, Mixes, Games, Library, Search, in the
// user's order) in an M3 navigation
// bar, a floating rounded mini player above it, Now Playing rising over the page on the album's
// colours, and the lyrics view.

sealed interface Route {
  data object Home : Route
  data object Search : Route
  data object Library : Route
  data object Mixes : Route
  data object Games : Route
  data class Game(val kind: GameKind) : Route
  data class LibraryList(val kind: String) : Route
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

/** The back stack: the tabs are roots; pages stack on them. */
class Nav(first: Route = Route.Home) {
  val stack = mutableStateListOf(first)
  val top: Route get() = stack.last()

  /** The last move, for the page transition: in, back, or across the tabs (0). */
  var direction by mutableStateOf(0)
    private set

  fun go(r: Route) {
    direction = 1
    stack += r
  }

  fun root(r: Route) {
    direction = 0
    stack.clear()
    stack += r
  }

  fun back() {
    direction = -1
    if (stack.size > 1) stack.removeAt(stack.lastIndex)
  }
}

/** While it is in composition, the system bars' icons are light (for the album-coloured screens). */
@Composable
fun LightBarIcons() {
  val view = androidx.compose.ui.platform.LocalView.current
  if (view.isInEditMode) return
  androidx.compose.runtime.DisposableEffect(view) {
    val window = (view.context as? android.app.Activity)?.window ?: return@DisposableEffect onDispose {}
    val c = androidx.core.view.WindowCompat.getInsetsController(window, view)
    val status = c.isAppearanceLightStatusBars
    val nav = c.isAppearanceLightNavigationBars
    c.isAppearanceLightStatusBars = false
    c.isAppearanceLightNavigationBars = false
    onDispose {
      c.isAppearanceLightStatusBars = status
      c.isAppearanceLightNavigationBars = nav
    }
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
  val nav = remember { Nav(tabRoute(app.prefs.state.value.tabOrder.first())) }
  val player by app.playback.state.collectAsStateWithLifecycle()
  var queueOpen by remember { mutableStateOf(false) }
  var picking by remember { mutableStateOf<List<Track>?>(null) }
  val chrome = remember { StageChrome() }
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  // The page behind the bars, for their frosted glass.
  val glass = remember { HazeState() }
  BackHandler(enabled = nav.stack.size > 1) { nav.back() }
  val picker = { t: Track -> picking = listOf(t) }

  Box(Modifier.fillMaxSize().background(Chamber.ground)) {
    Box(Modifier.fillMaxSize()) {
      // The page under Now Playing and the lyrics view: the stack's top below them.
      val page = nav.stack.lastOrNull { it != Route.NowPlaying && it != Route.Listen } ?: Route.Home
      val pages = rememberSaveableStateHolder()
      val still = app.prefs.reducedMotion(prefs)
      if (nav.top == Route.Listen)
        // The lyrics view: the room and the lyrics, the transport floating over it, always dark.
        EchoTheme(forceDark = true) {
        LightBarIcons()
        StageScreen(
          chrome,
          onClose = { nav.back() },
          dock = {
            Box(Modifier.windowInsetsPadding(WindowInsets.navigationBars).padding(12.dp)) {
              StageDock(player, chrome, onQueue = { queueOpen = true })
            }
          },
        )
        }
      else {
        // The page. A new one fades and rises in (the web's View Transition), the old one fades out
        // quickly.
        Box(Modifier.fillMaxSize().matterGround(Chamber.ground).hazeSource(glass).windowInsetsPadding(WindowInsets.statusBars)) {
          SharedTransitionLayout {
          val shared = this
          AnimatedContent(
            page,
            transitionSpec = {
              // A page springs in from the side it comes from; the tabs cross-fade with a breath of scale.
              val move = spring<IntOffset>(dampingRatio = 0.86f, stiffness = 380f)
              val fade = spring<Float>(stiffness = 500f)
              when {
                still -> EnterTransition.None togetherWith ExitTransition.None
                nav.direction == 0 -> (fadeIn(fade) + scaleIn(spring(dampingRatio = 0.8f, stiffness = 420f), initialScale = 0.97f)) togetherWith fadeOut(tween(90))
                nav.direction > 0 -> (slideInHorizontally(move) { it / 5 } + fadeIn(fade)) togetherWith (slideOutHorizontally(move) { -it / 12 } + fadeOut(tween(160)))
                else -> (slideInHorizontally(move) { -it / 12 } + fadeIn(fade)) togetherWith (slideOutHorizontally(move) { it / 5 } + fadeOut(tween(160)))
              }.using(SizeTransform(clip = false))
            },
            label = "page",
          ) { r ->
            // Each page keeps its scroll position (and other saved state) for Back.
            CompositionLocalProvider(LocalFlight provides Flight(shared, this)) {
            pages.SaveableStateProvider(r.toString()) {
            when (r) {
              Route.Home -> HomeScreen(nav, onProfile = { nav.go(Route.Settings) })
              Route.Search -> SearchScreen(nav, picker)
              Route.Library -> YourLibraryScreen(nav, onProfile = { nav.go(Route.Settings) })
              Route.Mixes -> MixesScreen(nav)
              Route.Games -> GamesScreen(nav)
              is Route.Game -> GameScreen(r.kind, nav)
              is Route.LibraryList -> LibraryListScreen(r.kind, nav)
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
          }
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
          if (player.track != null && nav.top !is Route.Game) Box(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) { MiniPlayer(player, glass) { nav.go(Route.NowPlaying) } }
          TabBar(nav, prefs.tabOrder, glass)
        }
      }
      // Now Playing rises from the mini player over the page, and sinks back (Spotify's).
      AnimatedVisibility(
        nav.top == Route.NowPlaying,
        enter = if (still) EnterTransition.None else slideInVertically(spring(dampingRatio = 0.9f, stiffness = 420f)) { it } + fadeIn(tween(160)),
        exit = if (still) ExitTransition.None else slideOutVertically(tween(260)) { it } + fadeOut(tween(260)),
      ) {
        EchoTheme(forceDark = true) { LightBarIcons(); NowPlayingScreen(player, nav, onQueue = { queueOpen = true }, picker = picker) }
      }
      player.notice?.let { msg ->
        LaunchedEffect(msg) {
          delay(3000)
          app.playback.dismissNotice()
        }
        Box(Modifier.fillMaxSize().padding(bottom = 160.dp), contentAlignment = Alignment.BottomCenter) {
          // An M3 snackbar.
          Surface(Modifier.padding(16.dp), RoundedCornerShape(4.dp), MaterialTheme.colorScheme.inverseSurface, shadowElevation = 6.dp) {
            Text(msg, color = MaterialTheme.colorScheme.inverseOnSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp))
          }
        }
      }
      if (queueOpen) QueueSheet(player, onClose = { queueOpen = false })
      TogetherHost()
      MenuSheet()
      picking?.let { PlaylistPicker(it) { picking = null } }
    }
  }
}

/** A tab's label and icon by its id (Prefs.tabs). */
fun tabInfo(id: String): Pair<String, ImageVector> =
  when (id) {
    "mixes" -> "Mixes" to EchoIcons.radio
    "games" -> "Games" to EchoIcons.gamepad
    "library" -> "Library" to EchoIcons.library
    "search" -> "Search" to EchoIcons.search
    else -> "Home" to EchoIcons.home
  }

fun tabRoute(id: String): Route =
  when (id) {
    "mixes" -> Route.Mixes
    "games" -> Route.Games
    "library" -> Route.Library
    "search" -> Route.Search
    else -> Route.Home
  }

/** The tabs, in the user's order, as an M3 navigation bar: a pill behind the current one's icon. */
@Composable
private fun TabBar(nav: Nav, order: List<String>, glass: HazeState) {
  val tabs = order.map { id -> tabInfo(id).let { (label, icon) -> Triple(label, tabRoute(id), icon) } }
  val root = nav.stack.first()
  val haptics = rememberHaptics()
  val bar = MaterialTheme.colorScheme.surfaceContainer
  val made = look.material != Material.Flat
  NavigationBar(
    containerColor = Color.Transparent,
    windowInsets = if (made) WindowInsets(0) else NavigationBarDefaults.windowInsets,
    modifier =
      if (made) Modifier.windowInsetsPadding(WindowInsets.navigationBars).padding(start = 12.dp, end = 12.dp, bottom = 10.dp).matter(matter.paper, 26.dp, seed = 4, rib = true)
      else Modifier.hazeEffect(glass, HazeStyle(backgroundColor = bar, tints = listOf(HazeTint(bar.copy(alpha = 0.72f))), blurRadius = 28.dp, noiseFactor = 0.03f)),
  ) {
    for ((label, route, icon) in tabs) {
      val on = root == route
      NavigationBarItem(
        selected = on,
        onClick = {
          haptics.tick()
          nav.root(route)
        },
        colors = if (made) NavigationBarItemDefaults.colors(indicatorColor = matter.accent(1), selectedIconColor = inkOn(matter.accent(1), matter.ink), selectedTextColor = MaterialTheme.colorScheme.primary) else if (look.navPill) NavigationBarItemDefaults.colors() else NavigationBarItemDefaults.colors(indicatorColor = Color.Transparent, selectedIconColor = MaterialTheme.colorScheme.primary, selectedTextColor = MaterialTheme.colorScheme.primary),
        icon = { Icon(if (on && route == Route.Home) EchoIcons.homeFilled else icon, null, modifier = Modifier.size(24.dp)) },
        label = { Text(label, style = MaterialTheme.typography.labelMedium) },
        modifier = Modifier.semantics { contentDescription = label },
      )
    }
  }
}

/** The mini player: a floating rounded bar over the page, play/pause and next, a hairline of progress. */
@Composable
private fun MiniPlayer(p: PlayerState, glass: HazeState, onOpen: () -> Unit) {
  val app = LocalContext.current.echo
  val t = p.track ?: return
  val haptics = rememberHaptics()
  val shape = RoundedCornerShape(look.mini)
  val tint = MaterialTheme.colorScheme.surfaceContainerHighest
  val made = look.material != Material.Flat
  val miniColour = matter.strong
  Surface(
    if (made) Modifier.fillMaxWidth().height(66.dp).matter(miniColour, look.mini, seed = 9)
    else
      Modifier.fillMaxWidth().height(64.dp).shadow(10.dp, shape).clip(shape)
        .hazeEffect(glass, HazeStyle(backgroundColor = tint, tints = listOf(HazeTint(tint.copy(alpha = 0.68f))), blurRadius = 24.dp, noiseFactor = 0.03f)),
    shape,
    Color.Transparent,
    if (made) inkOn(miniColour, matter.ink) else Chamber.text,
  ) {
    Box(Modifier.fillMaxSize()) {
      // Swipe sideways for the next or previous song, up for Now Playing (Spotify's mini player).
      Row(
        Modifier.fillMaxSize().swipes(left = app.playback::next, right = app.playback::previous, up = onOpen).clickable(onClick = onOpen)
          .padding(start = 8.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Artwork(t.cover, t.album.title, 48.dp, radius = minOf(look.rowArt + 2.dp, 24.dp))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
          Text(t.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          Text(t.artist, color = Chamber.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(
          Modifier.size(44.dp).clip(CircleShape).clickable {
            haptics.toggle(!p.playing)
            app.playback.toggle()
          }.semantics { contentDescription = if (p.playing) "Pause" else "Play" },
          contentAlignment = Alignment.Center,
        ) { Icon(if (p.playing) EchoIcons.pause else EchoIcons.play, null, tint = Chamber.text, modifier = Modifier.size(26.dp)) }
        Box(
          Modifier.size(44.dp).clip(CircleShape).clickable {
            haptics.tap()
            app.playback.next()
          }.semantics { contentDescription = "Next" },
          contentAlignment = Alignment.Center,
        ) { Icon(EchoIcons.next, null, tint = Chamber.text, modifier = Modifier.size(24.dp)) }
      }
      Progress(p, Modifier.align(Alignment.BottomCenter).padding(horizontal = 22.dp), fill = MaterialTheme.colorScheme.primary, track = Color.Transparent)
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

/** The transport over the lyrics view: an M3 floating toolbar that fades with the chrome. */
@Composable
private fun StageDock(p: PlayerState, chrome: StageChrome, onQueue: () -> Unit) {
  val app = LocalContext.current.echo
  val shown = chrome.visible
  val alpha by animateFloatAsState(if (shown) 1f else 0f, tween(if (shown) 160 else 640), label = "dock")
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  Column(Modifier.fillMaxWidth().alpha(alpha)) {
    // Karaoke on: the vocals slider sits over the dock, so the level is a reach away while singing.
    if (prefs.karaoke)
      Box(Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(RoundedCornerShape(24.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 16.dp, vertical = 6.dp)) {
        VocalsSlider(Chamber.text)
      }
    Row(
      Modifier.fillMaxWidth().height(64.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainer)
        .padding(horizontal = 12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      IconBtn(EchoIcons.previous, "Previous", Chamber.text, 24) { app.playback.previous() }
      PlayButton(p.playing, enabled = p.track != null, onClick = app.playback::toggle, size = 44)
      IconBtn(EchoIcons.next, "Next", Chamber.text, 24) { app.playback.next() }
      Box(Modifier.weight(1f).padding(horizontal = 8.dp)) { Progress(p, height = 3) }
      IconBtn(EchoIcons.mic, if (prefs.karaoke) "Karaoke on" else "Karaoke off", if (prefs.karaoke) Chamber.text else Chamber.text.copy(alpha = 0.5f), 22) { app.karaoke.setOn(!prefs.karaoke) }
      IconBtn(EchoIcons.queue, "Queue", Chamber.text, 22, onQueue)
    }
  }
}

/** Play/pause: a rounded square in the ink colour (more round when small), the glyph cut out of it. */
@Composable
fun PlayButton(playing: Boolean, enabled: Boolean, onClick: () -> Unit, size: Int = 48) {
  val corner by animateFloatAsState(if (playing) 0.34f else 0.5f, spring(dampingRatio = 0.6f, stiffness = 500f), label = "shape")
  val haptics = rememberHaptics()
  val press = { haptics.toggle(!playing); onClick() }
  val made = look.material != Material.Flat
  val (source, down) = rememberPress()
  val fill = if (made) matter.accent(0) else if (enabled) Chamber.text else Chamber.surface3
  Box(
    (if (made) Modifier.size(size.dp).bouncy(enabled = enabled, scale = 0.94f, source = source, onClick = press).matter(fill, if (look.material == Material.Glass) (size / 2).dp else (size * 0.38f).dp, pressed = down, seed = size, depth = 1.3f)
    else Modifier.size(size.dp).bouncy(enabled = enabled, scale = 0.9f, onClick = press).clip(RoundedCornerShape((size * corner).dp)).background(fill))
      .semantics { contentDescription = if (playing) "Pause" else "Play" },
    contentAlignment = Alignment.Center,
  ) {
    Icon(if (playing) EchoIcons.pause else EchoIcons.play, null, tint = if (made) inkOn(fill, matter.ink) else Chamber.ground, modifier = Modifier.size((size * 0.45f).dp))
  }
}
