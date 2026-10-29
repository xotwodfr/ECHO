package com.folk3s.echo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.Album
import com.folk3s.echo.api.ArtistCard
import com.folk3s.echo.api.ArtistInfo
import com.folk3s.echo.api.Genre
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.Playlist
import com.folk3s.echo.api.PlaylistDetail
import com.folk3s.echo.api.Track
import com.folk3s.echo.echo
import com.folk3s.echo.library.AlbumList
import com.folk3s.echo.library.AlbumSort
import com.folk3s.echo.library.SearchResult
import com.folk3s.echo.library.StarKind
import com.folk3s.echo.library.Status
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// The screens after Spotify's app (docs/superpowers/specs/2026-10-29-spotify-redesign-design.md):
// Home (a shortcut grid and shelves), Search (Browse all's genre cards), Your Library (chips and a
// list), and pages that open on a header tinted by their cover with the green play button.

/** One screen's load: loading, the value, not there (null), or failed (Retry). */
sealed interface Load<out T> {
  data object Loading : Load<Nothing>
  data class Ok<T>(val value: T) : Load<T>
  data object Failed : Load<Nothing>
}

@Composable
fun <T> load(key: Any?, fetch: suspend () -> T): Pair<Load<T>, () -> Unit> {
  var attempt by remember { mutableIntStateOf(0) }
  var state by remember(key) { mutableStateOf<Load<T>>(Load.Loading) }
  LaunchedEffect(key, attempt) {
    state = Load.Loading
    state = runCatching { fetch() }.fold({ Load.Ok(it) }, { Load.Failed })
  }
  return state to { attempt++ }
}

@Composable
fun nowKey(): String? {
  val s by LocalContext.current.echo.playback.state.collectAsStateWithLifecycle()
  return s.track?.key
}

/** The bottom of every list clears the mini player and the tab bar floating over it. */
val BottomRoom = PaddingValues(bottom = 168.dp)

// ---- Pieces ----

/** Spotify's green play button; while its context plays it pauses and resumes it. */
@Composable
fun PlayFab(label: String, live: Boolean, playing: Boolean, onPlay: () -> Unit, size: Int = 56) {
  val app = LocalContext.current.echo
  Box(
    Modifier.size(size.dp).clip(CircleShape).background(Chamber.green)
      .clickable { if (live) app.playback.toggle() else onPlay() }
      .semantics { contentDescription = if (playing) "Pause $label" else "Play $label" },
    contentAlignment = Alignment.Center,
  ) { Icon(if (playing) EchoIcons.pause else EchoIcons.play, null, tint = Chamber.ground, modifier = Modifier.size((size * 0.42f).dp)) }
}

@Composable
fun contextLive(kind: String, id: String?): Pair<Boolean, Boolean> {
  val s by LocalContext.current.echo.playback.state.collectAsStateWithLifecycle()
  val ctx = LocalContext.current.echo.playback.context.collectAsStateWithLifecycle().value
  val live = s.track != null && ctx?.kind == kind && (id == null || ctx.id == id)
  return live to (live && s.playing)
}

/** The heart: outline, or filled green once the song is in Liked Songs. */
@Composable
fun Heart(t: Track, size: Int = 24) {
  val app = LocalContext.current.echo
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  val on = starred?.tracks?.any { it.id == t.id } == true
  val scope = rememberCoroutineScope()
  Box(
    Modifier.size(40.dp).clip(CircleShape).clickable {
      scope.launch {
        runCatching { app.library.setStar(StarKind.Track, t.id, !on, track = t) }
          .onSuccess { app.playback.notify(if (on) "Removed from Liked Songs" else "Added to Liked Songs") }
          .onFailure { app.playback.notify("Couldn't save that. Try again.") }
      }
    }.semantics { contentDescription = if (on) "Remove ${t.title} from Liked Songs" else "Add ${t.title} to Liked Songs" },
    contentAlignment = Alignment.Center,
  ) { Icon(if (on) EchoIcons.heartFilled else EchoIcons.heart, null, tint = if (on) Chamber.green else Chamber.muted, modifier = Modifier.size(size.dp)) }
}

/** A song's menu: Add to playlist, song radio, the queue, where it came from. */
fun songMenu(app: EchoApp, t: Track, nav: Nav, picker: (Track) -> Unit, extra: List<Pair<String, () -> Unit>> = emptyList()): List<Pair<String, () -> Unit>> =
  listOf<Pair<String, () -> Unit>>("Add to playlist" to { picker(t) }) +
    extra +
    listOf<Pair<String, () -> Unit>>(
      "Go to song radio" to { app.scope.launch { runCatching { startRadio(app, t) }.onFailure { app.playback.notify("Couldn't start the radio.") } } },
      "Play next" to { app.playback.playNext(t) },
      "Add to queue" to { app.playback.addToQueue(t) },
    ) +
    listOfNotNull(
      t.artists.firstOrNull()?.id?.let { id -> "Go to artist" to { nav.go(Route.Artist(id)) } },
      t.album.id?.let { id -> "Go to album" to { nav.go(Route.Album(id)) } },
    )

suspend fun startRadio(app: EchoApp, seed: Track) {
  val similar = app.library.similarSongs(seed, 50).filter { it.id != seed.id }
  app.playback.playList(listOf(seed) + similar, 0, PlayContext("radio", seed.id, "${seed.title} Radio"))
}

/** Spotify's song row: the cover (or nothing on an album), title, artist, the heart once saved, ⋯. */
@Composable
fun SongRow(t: Track, nowPlaying: Boolean, onPlay: () -> Unit, showArt: Boolean, menu: List<Pair<String, () -> Unit>>) {
  val app = LocalContext.current.echo
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  Row(
    Modifier.fillMaxWidth().clickable(onClick = onPlay).padding(horizontal = 16.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    if (showArt) Artwork(t.cover, t.album.title, 48.dp)
    Column(Modifier.weight(1f)) {
      Text(t.title, color = if (nowPlaying) Chamber.green else Chamber.text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Row(verticalAlignment = Alignment.CenterVertically) {
        if (nowPlaying) {
          NowPlayingBars()
          Spacer(Modifier.width(6.dp))
        }
        Text(t.artist, color = Chamber.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
    if (starred?.tracks?.any { it.id == t.id } == true) Heart(t, 20)
    MoreMenu("More for ${t.title}", menu)
  }
}

/** A card: the cover (round for artists), a title and a subtitle. */
@Composable
fun Card(
  cover: String?,
  title: String,
  subtitle: String,
  width: Int? = 144,
  round: Boolean = false,
  art: (@Composable () -> Unit)? = null,
  onClick: () -> Unit,
) {
  Column((if (width != null) Modifier.width(width.dp) else Modifier).clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick)) {
    Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(if (round) CircleShape else RoundedCornerShape(6.dp))) {
      if (art != null) art() else Artwork(cover, title, null, radius = if (round) 999.dp else 6.dp)
    }
    Spacer(Modifier.height(8.dp))
    Text(title, color = Chamber.text, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
    Text(subtitle, color = Chamber.muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
  }
}

/** Liked Songs' cover: Spotify's violet to mint, a white heart. */
@Composable
fun LikedArt(size: Int) {
  Box(
    Modifier.size(size.dp).clip(RoundedCornerShape(4.dp)).background(Brush.linearGradient(listOf(Chamber.likedFrom, Chamber.likedTo))),
    contentAlignment = Alignment.Center,
  ) { Icon(EchoIcons.heartFilled, null, tint = Chamber.text, modifier = Modifier.size((size * 0.4f).dp)) }
}

@Composable
fun Shelf(title: String, content: LazyListScope.() -> Unit) {
  Column(Modifier.padding(top = 24.dp)) {
    Text(title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), content = content)
  }
}

@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
  Box(
    Modifier.clip(CircleShape).background(if (selected) Chamber.green else Chamber.surface3).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 7.dp),
  ) { Text(text, color = if (selected) Chamber.ground else Chamber.text, style = MaterialTheme.typography.bodyMedium) }
}

/** The tone of an album's header, from its palette (grey while unknown). */
@Composable
fun tintOf(albumKey: String?): Color {
  val app = LocalContext.current.echo
  val tint by produceState(Chamber.headFallback, albumKey) {
    value = albumKey?.let { app.palette.forAlbum(it) }?.let { headerTone(it.accentColor) } ?: Chamber.headFallback
  }
  return tint
}

/** A page's top: the tint fading into the page, with its content (cover, title, facts) on it. */
@Composable
fun TintedHeader(tint: Color, content: @Composable () -> Unit) {
  Box(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(tint, tint.copy(alpha = 0.6f).compositeOver(Chamber.surface1), Chamber.surface1)))) {
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp)) { content() }
  }
}

fun Color.compositeOver(bg: Color): Color =
  Color(red * alpha + bg.red * (1 - alpha), green * alpha + bg.green * (1 - alpha), blue * alpha + bg.blue * (1 - alpha), 1f)

@Composable
private fun BackRow(nav: Nav) {
  if (nav.stack.size < 2) return
  Box(
    Modifier.padding(start = 8.dp, top = 8.dp).size(40.dp).clip(CircleShape).background(Chamber.ground.copy(alpha = 0.4f)).clickable { nav.back() }
      .semantics { contentDescription = "Back" },
    contentAlignment = Alignment.Center,
  ) { Icon(EchoIcons.chevronLeft, null, tint = Chamber.text, modifier = Modifier.size(24.dp)) }
}

// ---- Home ----

@Composable
fun HomeScreen(nav: Nav, onProfile: () -> Unit) {
  val app = LocalContext.current.echo
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  val playlists by app.library.playlistsFlow.collectAsStateWithLifecycle()
  val (recent, _) = load("recent") { app.library.albumList(AlbumList.Recent, 12) }
  val (newest, _) = load("newest") { app.library.albumList(AlbumList.Newest, 12) }
  val (frequent, _) = load("frequent") { app.library.albumList(AlbumList.Frequent, 12) }
  val (random, _) = load("random") { app.library.albumList(AlbumList.Random, 12) }
  val (mixes, _) = load("mixes") { app.library.mixes() }
  val (contexts, _) = load("contexts") { app.library.playedContexts() }
  var filter by remember { mutableStateOf("All") }
  fun albums(l: Load<List<Album>>) = (l as? Load.Ok)?.value ?: emptyList()
  LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
    item {
      Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(32.dp).clip(CircleShape).background(Color(0xFFF59B23)).clickable(onClick = onProfile).semantics { contentDescription = "Profile and settings" }, contentAlignment = Alignment.Center) {
          Icon(EchoIcons.user, null, tint = Chamber.ground, modifier = Modifier.size(18.dp))
        }
        for (c in listOf("All", "Music", "Playlists")) Chip(c, filter == c) { filter = c }
      }
    }
    // The shortcut grid: Liked Songs and what was played last, two columns.
    item {
      val tiles = buildList<Pair<String, @Composable () -> Unit>> {
        add("liked" to { Shortcut("Liked Songs", { LikedArt(56) }) { nav.go(Route.Liked) } })
        for (a in (albums(recent).ifEmpty { albums(newest) }).take(7)) add(a.id to { Shortcut(a.title, { Artwork(a.cover, a.title, 56.dp, radius = 0.dp) }) { nav.go(Route.Album(a.id)) } })
      }
      Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (pair in tiles.chunked(2)) {
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((_, tile) in pair) Box(Modifier.weight(1f)) { tile() }
            if (pair.size == 1) Spacer(Modifier.weight(1f))
          }
        }
      }
    }
    if (filter != "Playlists") madeForYou(mixes, contexts, nav)
    if (filter != "Playlists") {
      for ((title, l) in listOf("Recently played" to recent, "New in your library" to newest)) {
        val list = albums(l)
        if (list.isNotEmpty()) item(title) { Shelf(title) { items(list, key = { it.id }) { a -> Card(a.cover, a.title, a.artist) { nav.go(Route.Album(a.id)) } } } }
      }
    }
    if (filter != "Music") {
      val pl = playlists ?: emptyList()
      if (pl.isNotEmpty()) item("playlists") { Shelf("Your playlists") { items(pl, key = { it.id }) { p -> Card(p.cover, p.name, p.owner ?: "${p.tracks} songs") { nav.go(Route.Playlist(p.id)) } } } }
    }
    if (filter != "Playlists") {
      for ((title, l) in listOf("Your most played" to frequent, "Something different" to random)) {
        val list = albums(l)
        if (list.isNotEmpty()) item(title) { Shelf(title) { items(list, key = { it.id }) { a -> Card(a.cover, a.title, a.artist) { nav.go(Route.Album(a.id)) } } } }
      }
      val artists = albums(frequent).filter { it.artistId != null }.distinctBy { it.artistId }
      if (artists.size >= 2) item("artists") { Shelf("Artists you play") { items(artists, key = { it.artistId!! }) { a -> Card(a.cover, a.artist, "Artist", round = true) { nav.go(Route.Artist(a.artistId!!)) } } } }
    }
    @Suppress("UNUSED_EXPRESSION") starred
  }
}

@Composable
private fun Shortcut(title: String, art: @Composable () -> Unit, onClick: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(4.dp)).background(Color.White.copy(alpha = 0.1f)).clickable(onClick = onClick),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    art()
    Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 8.dp))
  }
}

// ---- Search ----

val GENRE_COLOURS = listOf(0xFFE8115B, 0xFF1E3264, 0xFF8D67AB, 0xFFE91429, 0xFF148A08, 0xFFBA5D07, 0xFF503750, 0xFF0D73EC, 0xFFDC148C, 0xFF27856A, 0xFF477D95, 0xFFAF2896)

/** A genre keeps its colour: picked by name, as on the web. */
fun genreColour(name: String): Color {
  var h = 7L
  for (ch in name) h = (h * 31 + ch.code) and 0xFFFFFFFFL
  return Color(GENRE_COLOURS[(h % GENRE_COLOURS.size).toInt()])
}

@Composable
fun SearchScreen(nav: Nav, picker: (Track) -> Unit) {
  val app = LocalContext.current.echo
  val now = nowKey()
  var q by remember { mutableStateOf("") }
  var remote by remember { mutableStateOf<SearchResult?>(null) }
  var failed by remember { mutableStateOf(false) }
  LaunchedEffect(q) {
    remote = null
    failed = false
    if (q.isBlank()) return@LaunchedEffect
    delay(250)
    runCatching { app.library.searchRemote(q.trim()) }.onSuccess { remote = it }.onFailure { failed = true }
  }
  val (genres, retryGenres) = load("genres") { app.library.genres() }
  val local = app.library.search(q)
  val tracks = (local.tracks + (remote?.tracks ?: emptyList())).distinctBy { it.key }.take(50)
  val albums = (local.albums + (remote?.albums ?: emptyList())).distinctBy { it.id }
  val artists = remote?.artists ?: emptyList()
  Column(Modifier.fillMaxSize()) {
    Text("Search", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 12.dp))
    // Spotify's white search box.
    Row(
      Modifier.padding(horizontal = 16.dp).fillMaxWidth().height(48.dp).clip(RoundedCornerShape(6.dp)).background(Chamber.text).padding(horizontal = 12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(EchoIcons.search, null, tint = Chamber.ground, modifier = Modifier.size(24.dp))
      Spacer(Modifier.width(10.dp))
      Box(Modifier.weight(1f)) {
        if (q.isEmpty()) Text("What do you want to play?", color = Chamber.surface4, style = MaterialTheme.typography.bodyLarge)
        BasicTextField(q, { q = it }, singleLine = true, textStyle = MaterialTheme.typography.bodyLarge.copy(color = Chamber.ground), cursorBrush = SolidColor(Chamber.ground), modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Search" })
      }
    }
    when {
      q.isBlank() ->
        when (genres) {
          Load.Loading -> Loading()
          Load.Failed -> BlockError("Couldn't load genres.", retryGenres)
          is Load.Ok ->
            LazyVerticalGrid(GridCells.Fixed(2), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 168.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
              item(span = { GridItemSpan(maxLineSpan) }) { Text("Browse all", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(vertical = 4.dp)) }
              items(genres.value, key = { it.name }) { g -> GenreCard(g) { nav.go(Route.Genre(g.name)) } }
            }
        }
      tracks.isEmpty() && albums.isEmpty() && artists.isEmpty() && (remote != null || failed) ->
        Empty(if (failed) "Search didn't answer." else "No results for “${q.trim()}”.")
      else ->
        LazyColumn(contentPadding = BottomRoom) {
          if (artists.isNotEmpty()) item { Shelf("Artists") { items(artists, key = { it.id }) { a -> Card(a.image, a.name, "Artist", round = true) { nav.go(Route.Artist(a.id)) } } } }
          if (albums.isNotEmpty()) item { Shelf("Albums") { items(albums.take(12), key = { it.id }) { a -> Card(a.cover, a.title, a.artist) { nav.go(Route.Album(a.id)) } } } }
          if (tracks.isNotEmpty()) {
            item { Text("Songs", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(start = 16.dp, top = 24.dp, bottom = 8.dp)) }
            itemsIndexed(tracks, key = { _, t -> "t:${t.key}" }) { i, t ->
              SongRow(t, t.key == now, { app.playback.playList(tracks, i, PlayContext("search", title = "“${q.trim()}”")) }, true, songMenu(app, t, nav, picker))
            }
          }
        }
    }
  }
}

@Composable
private fun GenreCard(g: Genre, onClick: () -> Unit) {
  Box(Modifier.fillMaxWidth().height(96.dp).clip(RoundedCornerShape(8.dp)).background(genreColour(g.name)).clickable(onClick = onClick).padding(12.dp)) {
    Text(g.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    Text("${g.albums} album${if (g.albums == 1) "" else "s"}", color = Chamber.text.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall, modifier = Modifier.align(Alignment.BottomStart))
  }
}

@Composable
fun GenreScreen(name: String, nav: Nav) {
  val app = LocalContext.current.echo
  val (state, retry) = load(name) { app.library.genreAlbums(name) }
  Column(Modifier.fillMaxSize()) {
    Box(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(genreColour(name), Chamber.surface1)))) {
      BackRow(nav)
      Text(name, style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(start = 16.dp, top = 72.dp, bottom = 16.dp, end = 16.dp))
    }
    when (state) {
      Load.Loading -> Loading()
      Load.Failed -> BlockError("Couldn't load this.", retry)
      is Load.Ok -> AlbumGrid(state.value, nav)
    }
  }
}

@Composable
fun AlbumGrid(albums: List<Album>, nav: Nav) {
  LazyVerticalGrid(
    columns = GridCells.Adaptive(140.dp),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 168.dp),
    horizontalArrangement = Arrangement.spacedBy(16.dp),
    verticalArrangement = Arrangement.spacedBy(20.dp),
    modifier = Modifier.fillMaxSize(),
  ) {
    items(albums, key = { it.id }) { a -> Card(a.cover, a.title, a.artist, width = null) { nav.go(Route.Album(a.id)) } }
  }
}

// ---- Your Library ----

private enum class LibFilter(val label: String) { Playlists("Playlists"), Albums("Albums"), Artists("Artists") }

@Composable
fun YourLibraryScreen(nav: Nav, onProfile: () -> Unit) {
  val app = LocalContext.current.echo
  val albums by app.library.albums.collectAsStateWithLifecycle()
  val status by app.library.status.collectAsStateWithLifecycle()
  val sort by app.library.sort.collectAsStateWithLifecycle()
  val playlists by app.library.playlistsFlow.collectAsStateWithLifecycle()
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  var filter by remember { mutableStateOf<LibFilter?>(null) }
  val scope = rememberCoroutineScope()
  Column(Modifier.fillMaxSize()) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
      Box(Modifier.size(32.dp).clip(CircleShape).background(Color(0xFFF59B23)).clickable(onClick = onProfile).semantics { contentDescription = "Profile and settings" }, contentAlignment = Alignment.Center) {
        Icon(EchoIcons.user, null, tint = Chamber.ground, modifier = Modifier.size(18.dp))
      }
      Text("Your Library", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(start = 12.dp).weight(1f))
      Box(
        Modifier.size(40.dp).clip(CircleShape).clickable {
          scope.launch { runCatching { app.library.createPlaylist("My Playlist #${(playlists?.size ?: 0) + 1}") }.onSuccess { id -> if (id.isNotBlank()) nav.go(Route.Playlist(id)) } }
        }.semantics { contentDescription = "Create playlist" },
        contentAlignment = Alignment.Center,
      ) { Icon(EchoIcons.plus, null, tint = Chamber.text, modifier = Modifier.size(26.dp)) }
    }
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      for (f in LibFilter.entries) Chip(f.label, filter == f) { filter = if (filter == f) null else f }
    }
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
      for (s in AlbumSort.entries)
        Text(s.label, color = if (s == sort) Chamber.green else Chamber.muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.clickable { app.library.setSort(s) }.padding(vertical = 4.dp))
    }
    if (status == Status.NotConnected) return@Column Empty("Nothing in your library yet. Connect a server in Settings on the web.")
    if (status == Status.Error && albums.isEmpty()) return@Column BlockError("Couldn't load your library.", app.library::reload)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
      if (filter == null || filter == LibFilter.Playlists) {
        item("liked") { LibRow({ LikedArt(56) }, "Liked Songs", "Playlist • ${starred?.tracks?.size ?: 0} songs") { nav.go(Route.Liked) } }
        items(playlists ?: emptyList(), key = { "p:${it.id}" }) { p ->
          LibRow({ if (p.cover != null) Artwork(p.cover, p.name, 56.dp) else EmptyArt(56) }, p.name, "Playlist • ${p.owner ?: "${p.tracks} songs"}") { nav.go(Route.Playlist(p.id)) }
        }
      }
      if (filter == null || filter == LibFilter.Albums) {
        if (status == Status.Loading && albums.isEmpty()) item { Loading() }
        items(albums, key = { "a:${it.id}" }) { a -> LibRow({ Artwork(a.cover, a.title, 56.dp) }, a.title, "Album • ${a.artist}") { nav.go(Route.Album(a.id)) } }
      }
      if (filter == LibFilter.Artists) {
        val artists = albums.filter { it.artistId != null }.groupBy { it.artistId!! }.map { (id, l) -> Triple(id, l.first().artist.trim(), l.first().cover) }.sortedBy { it.second.lowercase() }
        items(artists, key = { "r:${it.first}" }) { (id, name, cover) ->
          LibRow({ Box(Modifier.size(56.dp).clip(CircleShape)) { Artwork(cover, name, 56.dp, radius = 28.dp) } }, name, "Artist") { nav.go(Route.Artist(id)) }
        }
      }
    }
  }
}

@Composable
private fun EmptyArt(size: Int) {
  Box(Modifier.size(size.dp).clip(RoundedCornerShape(4.dp)).background(Chamber.surface3), contentAlignment = Alignment.Center) {
    Icon(EchoIcons.music, null, tint = Chamber.muted, modifier = Modifier.size((size * 0.45f).dp))
  }
}

@Composable
private fun LibRow(art: @Composable () -> Unit, title: String, sub: String, onClick: () -> Unit) {
  Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    art()
    Column(Modifier.weight(1f)) {
      Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(sub, color = Chamber.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
  }
}

// ---- Album, artist, playlist, Liked Songs ----

@Composable
fun AlbumScreen(id: String, nav: Nav, picker: (Track) -> Unit) {
  val app = LocalContext.current.echo
  val now = nowKey()
  val (state, retry) = load(id) { app.library.loadAlbum(id) }
  val tint = tintOf("navidrome:$id")
  val (live, playing) = contextLive("album", id)
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  val scope = rememberCoroutineScope()
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load this album.", retry)
    is Load.Ok -> {
      val a = state.value ?: return Empty("This album is not in your library.")
      val ctx = PlayContext("album", a.id, a.title)
      val saved = starred?.albums?.any { it.id == a.id } == true
      LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
        item {
          TintedHeader(tint) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Artwork(a.cover?.replace("size=300", "size=600"), a.title, 240.dp, radius = 4.dp) }
            Spacer(Modifier.height(16.dp))
            Text(a.title, style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(8.dp))
            Text(a.artist, style = MaterialTheme.typography.titleSmall, modifier = if (a.artistId != null) Modifier.clickable { nav.go(Route.Artist(a.artistId)) } else Modifier)
            Text(listOfNotNull("Album", a.year?.toString()).joinToString(" • "), color = Chamber.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
          }
          Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Box(
              Modifier.size(40.dp).clip(CircleShape).clickable {
                scope.launch { runCatching { app.library.setStar(StarKind.Album, a.id, !saved, album = a) } }
              }.semantics { contentDescription = if (saved) "Remove ${a.title} from Your Library" else "Save ${a.title} to Your Library" },
              contentAlignment = Alignment.Center,
            ) { Icon(if (saved) EchoIcons.check else EchoIcons.plus, null, tint = if (saved) Chamber.green else Chamber.muted, modifier = Modifier.size(28.dp)) }
            MoreMenu("More for ${a.title}", listOf("Add to queue" to { a.tracks.forEach(app.playback::addToQueue) }))
            Spacer(Modifier.weight(1f))
            IconBtn(EchoIcons.shuffle, "Shuffle ${a.title}") { app.playback.playList(a.tracks.shuffled(), 0, ctx) }
            PlayFab(a.title, live, playing, { app.playback.playList(a.tracks, 0, ctx) })
          }
        }
        itemsIndexed(a.tracks, key = { i, t -> "$i:${t.key}" }) { i, t ->
          SongRow(t, t.key == now, { app.playback.playList(a.tracks, i, ctx) }, false, songMenu(app, t, nav, picker))
        }
      }
    }
  }
}

@Composable
fun IconBtn(icon: ImageVector, label: String, tint: Color = Chamber.muted, size: Int = 28, onClick: () -> Unit) {
  Box(Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
    Icon(icon, null, tint = tint, modifier = Modifier.size(size.dp))
  }
}

@Composable
fun ArtistScreen(id: String, nav: Nav, picker: (Track) -> Unit) {
  val app = LocalContext.current.echo
  val now = nowKey()
  val (state, retry) = load(id) { app.library.artist(id) }
  val (info, _) = load("info:$id") { app.library.artistInfo(id) }
  val name = (state as? Load.Ok)?.value?.name
  val (top, _) = load("top:$name") { if (name == null) emptyList() else app.library.topSongs(name, 10) }
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  val following = starred?.artists?.any { it.id == id } == true
  val (live, playing) = contextLive("artist", id)
  val scope = rememberCoroutineScope()
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load this artist.", retry)
    is Load.Ok -> {
      val a = state.value ?: return Empty("This artist is not in your library.")
      val i = (info as? Load.Ok<ArtistInfo>)?.value
      val popular = (top as? Load.Ok<List<Track>>)?.value ?: emptyList()
      val ctx = PlayContext("artist", id, a.name)
      LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
        item {
          Box(Modifier.fillMaxWidth().height(300.dp)) {
            Artwork(i?.image ?: a.albums.firstOrNull()?.cover, a.name, null, Modifier.fillMaxSize(), radius = 0.dp)
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Chamber.surface1))))
            Text(a.name.trim(), style = MaterialTheme.typography.displayMedium, modifier = Modifier.align(Alignment.BottomStart).padding(16.dp))
          }
          Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
              if (following) "Following" else "Follow",
              style = MaterialTheme.typography.labelLarge,
              modifier = Modifier.clip(CircleShape).border(1.dp, Chamber.control, CircleShape).clickable {
                scope.launch { runCatching { app.library.setStar(StarKind.Artist, id, !following) } }
              }.padding(horizontal = 16.dp, vertical = 6.dp),
            )
            Spacer(Modifier.weight(1f))
            PlayFab(a.name, live, playing, {
              if (popular.isNotEmpty()) app.playback.playList(popular, 0, ctx)
              else scope.launch { runCatching { a.albums.mapNotNull { x -> app.library.loadAlbum(x.id) }.flatMap { it.tracks } }.onSuccess { if (it.isNotEmpty()) app.playback.playList(it, 0, ctx) } }
            })
          }
        }
        if (popular.isNotEmpty()) {
          item { Text("Popular", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 8.dp)) }
          itemsIndexed(popular.take(5), key = { n, t -> "p$n:${t.key}" }) { n, t ->
            SongRow(t, t.key == now, { app.playback.playList(popular, n, ctx) }, true, songMenu(app, t, nav, picker))
          }
        }
        item { Shelf("Discography") { items(a.albums, key = { it.id }) { x -> Card(x.cover, x.title, listOfNotNull(x.year?.toString(), "Album").joinToString(" • ")) { nav.go(Route.Album(x.id)) } } } }
        if (i != null && i.similar.isNotEmpty()) item { Shelf("Fans also like") { items(i.similar, key = { it.id }) { s -> Card(s.image, s.name, "Artist", round = true) { nav.go(Route.Artist(s.id)) } } } }
        if (i?.bio != null) item {
          Column(Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Chamber.surface2).padding(16.dp)) {
            Text("About", style = MaterialTheme.typography.headlineSmall)
            Text(i.bio, color = Chamber.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 6, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
          }
        }
      }
    }
  }
}

@Composable
fun PlaylistScreen(id: String, nav: Nav, picker: (Track) -> Unit) {
  val app = LocalContext.current.echo
  val now = nowKey()
  var version by remember { mutableIntStateOf(0) }
  val (state, retry) = load("$id:$version") { app.library.playlist(id) }
  val tint = tintOf((state as? Load.Ok<PlaylistDetail?>)?.value?.entries?.firstOrNull()?.album?.key)
  val (live, playing) = contextLive("playlist", id)
  val scope = rememberCoroutineScope()
  var editing by remember { mutableStateOf(false) }
  var deleting by remember { mutableStateOf(false) }
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load this playlist.", retry)
    is Load.Ok -> {
      val p = state.value ?: return Empty("This playlist does not exist.")
      val ctx = PlayContext("playlist", id, p.playlist.name)
      LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
        item {
          TintedHeader(tint) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
              if (p.covers.size >= 4)
                Column(Modifier.size(240.dp)) {
                  for (row in p.covers.take(4).chunked(2)) Row(Modifier.weight(1f)) { for (c in row) Box(Modifier.weight(1f)) { Artwork(c, p.playlist.name, null, Modifier.fillMaxSize(), radius = 0.dp) } }
                }
              else if (p.covers.isNotEmpty()) Artwork(p.covers.first(), p.playlist.name, 240.dp, radius = 4.dp)
              else EmptyArt(240)
            }
            Spacer(Modifier.height(16.dp))
            Text(p.playlist.name, style = MaterialTheme.typography.headlineMedium)
            p.comment?.let { Text(it, color = Chamber.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp)) }
            Text(listOfNotNull(p.playlist.owner, "${p.entries.size} songs, ${duration(p.durationMs)}").joinToString(" • "), color = Chamber.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
          }
          Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            MoreMenu("More for ${p.playlist.name}", listOf("Edit details" to { editing = true }, "Delete" to { deleting = true }))
            Spacer(Modifier.weight(1f))
            if (p.entries.isNotEmpty()) {
              IconBtn(EchoIcons.shuffle, "Shuffle ${p.playlist.name}") { app.playback.playList(p.entries.shuffled(), 0, ctx) }
              IconBtn(EchoIcons.smartShuffle, "Smart Shuffle ${p.playlist.name}") { smartShuffle(app, scope, p.entries, ctx) }
              PlayFab(p.playlist.name, live, playing, { app.playback.playList(p.entries, 0, ctx) })
            }
          }
        }
        if (p.entries.isEmpty()) item { Empty("Let's find something for your playlist. Add songs from any song’s menu.") }
        itemsIndexed(p.entries, key = { n, t -> "$n:${t.key}" }) { n, t ->
          SongRow(t, t.key == now, { app.playback.playList(p.entries, n, ctx) }, true, songMenu(app, t, nav, picker, listOf("Remove from this playlist" to {
            scope.launch { runCatching { app.library.updatePlaylist(id, remove = listOf(n)) }.onSuccess { version++ } }
          })))
        }
      }
      if (editing) {
        var name by remember { mutableStateOf(p.playlist.name) }
        var comment by remember { mutableStateOf(p.comment ?: "") }
        AlertDialog(
          onDismissRequest = { editing = false },
          title = { Text("Edit details") },
          text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
              OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true)
              OutlinedTextField(comment, { comment = it }, label = { Text("Description") })
            }
          },
          confirmButton = {
            TextButton(onClick = {
              editing = false
              scope.launch { runCatching { app.library.updatePlaylist(id, name = name.trim(), comment = comment.trim()) }.onSuccess { version++ } }
            }, enabled = name.isNotBlank()) { Text("Save", color = Chamber.green) }
          },
          dismissButton = { TextButton(onClick = { editing = false }) { Text("Cancel", color = Chamber.text) } },
          containerColor = Chamber.surface3,
        )
      }
      if (deleting)
        AlertDialog(
          onDismissRequest = { deleting = false },
          title = { Text("Delete ${p.playlist.name}?") },
          text = { Text("This will delete the playlist from Your Library.") },
          confirmButton = {
            TextButton(onClick = {
              deleting = false
              scope.launch { runCatching { app.library.deletePlaylist(id) }.onSuccess { nav.back() } }
            }) { Text("Delete", color = Chamber.negative) }
          },
          dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel", color = Chamber.text) } },
          containerColor = Chamber.surface3,
        )
    }
  }
}

@Composable
fun LikedScreen(nav: Nav, picker: (Track) -> Unit) {
  val app = LocalContext.current.echo
  val now = nowKey()
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  val tracks = starred?.tracks ?: emptyList()
  val ctx = PlayContext("starred", title = "Liked Songs")
  val (live, playing) = contextLive("starred", null)
  val scope = rememberCoroutineScope()
  LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
    item {
      Box(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Chamber.likedFrom, Chamber.likedFrom.copy(alpha = 0.35f).compositeOver(Chamber.surface1), Chamber.surface1)))) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 96.dp, bottom = 8.dp)) {
          Text("Liked Songs", style = MaterialTheme.typography.displaySmall)
          Text("${tracks.size} songs", color = Chamber.text.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
        }
      }
      if (tracks.isNotEmpty())
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
          Spacer(Modifier.weight(1f))
          IconBtn(EchoIcons.shuffle, "Shuffle Liked Songs") { app.playback.playList(tracks.shuffled(), 0, ctx) }
          IconBtn(EchoIcons.smartShuffle, "Smart Shuffle Liked Songs") { smartShuffle(app, scope, tracks, ctx) }
          PlayFab("Liked Songs", live, playing, { app.playback.playList(tracks, 0, ctx) })
        }
    }
    if (starred == null) item { Loading() }
    else if (tracks.isEmpty()) item { Empty("Songs you like will appear here. Save songs by tapping the heart icon.") }
    itemsIndexed(tracks, key = { n, t -> "$n:${t.key}" }) { n, t -> SongRow(t, t.key == now, { app.playback.playList(tracks, n, ctx) }, true, songMenu(app, t, nav, picker)) }
  }
}

/** Add to playlist: a new one first, then the user's playlists. */
@Composable
fun PlaylistPicker(tracks: List<Track>, onClose: () -> Unit) {
  val app = LocalContext.current.echo
  val playlists by app.library.playlistsFlow.collectAsStateWithLifecycle()
  val scope = rememberCoroutineScope()
  AlertDialog(
    onDismissRequest = onClose,
    title = { Text("Add to playlist") },
    text = {
      LazyColumn {
        item {
          LibRow({ EmptyArt(48) }, "New playlist", "") {
            onClose()
            scope.launch { runCatching { app.library.createPlaylist("My Playlist #${(playlists?.size ?: 0) + 1}", tracks.map { it.id }) }.onSuccess { app.playback.notify("Added to a new playlist") } }
          }
        }
        items(playlists ?: emptyList(), key = { it.id }) { p: Playlist ->
          LibRow({ if (p.cover != null) Artwork(p.cover, p.name, 48.dp) else EmptyArt(48) }, p.name, "${p.tracks} songs") {
            onClose()
            scope.launch { runCatching { app.library.updatePlaylist(p.id, add = tracks.map { it.id }) }.onSuccess { app.playback.notify("Added to ${p.name}") }.onFailure { app.playback.notify("Couldn't change the playlist. Try again.") } }
          }
        }
      }
    },
    confirmButton = { TextButton(onClick = onClose) { Text("Cancel", color = Chamber.text) } },
    containerColor = Chamber.surface3,
  )
}
