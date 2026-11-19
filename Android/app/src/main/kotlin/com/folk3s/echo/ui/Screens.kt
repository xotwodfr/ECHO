package com.folk3s.echo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.graphicsLayer
import coil3.compose.AsyncImage
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

// The screens (v0.2, 2026-11-17): Home (a large title, a featured mix, shelves of rounded art),
// Search (a rounded field, genre cards), Library (a list of categories, recently added), and pages
// that open on a centred cover with Play and Shuffle buttons.

/** One screen's load: loading, the value, not there (null), or failed (Retry). */
sealed interface Load<out T> {
  data object Loading : Load<Nothing>
  data class Ok<T>(val value: T) : Load<T>
  data object Failed : Load<Nothing>
}

/** Back is instant (the web's fresh.ts): the last answer per type and key, oldest out at 60. */
@PublishedApi
internal val loaded = object : LinkedHashMap<Pair<Any, Any?>, Any?>(64, 0.75f, true) {
  override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Pair<Any, Any?>, Any?>) = size > 60
}

/** A screen's data: shown at once when seen before and refreshed behind; a failed refresh keeps it. */
@Composable
inline fun <reified T> load(key: Any?, noinline fetch: suspend () -> T): Pair<Load<T>, () -> Unit> {
  val id = T::class to key
  var attempt by remember { mutableIntStateOf(0) }
  @Suppress("UNCHECKED_CAST")
  var state by remember(key) { mutableStateOf<Load<T>>(if (loaded.containsKey(id)) Load.Ok(loaded[id] as T) else Load.Loading) }
  LaunchedEffect(key, attempt) {
    val had = loaded.containsKey(id)
    if (!had) state = Load.Loading
    runCatching { fetch() }.fold({
      loaded[id] = it
      state = Load.Ok(it)
    }, { if (!had) state = Load.Failed })
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

/** The round play button in the accent; while its context plays it pauses and resumes it. */
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
  val guest by app.guests.me.collectAsStateWithLifecycle()
  if (guest != null) return // a guest's likes would land in the host's Navidrome
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  val on = starred?.tracks?.any { it.id == t.id } == true
  val scope = rememberCoroutineScope()
  val haptics = rememberHaptics()
  Box(
    Modifier.size(40.dp).clip(CircleShape).clickable {
      haptics.toggle(!on)
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
  // A guest listens only: no playlists of the host's to change (guests.ts).
  (if (app.guests.isGuest) emptyList() else listOf<Pair<String, () -> Unit>>("Add to playlist" to { picker(t) })) +
    extra +
    listOf<Pair<String, () -> Unit>>(
      "Go to song radio" to { app.scope.launch { runCatching { startRadio(app, t) }.onFailure { app.playback.notify("Couldn't start the radio.") } } },
      "Play next" to { app.playback.playNext(t) },
      "Add to queue" to { app.playback.addToQueue(t) },
      "Make karaoke version" to { app.karaoke.request(t) },
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
    // A long press opens the song's menu (Spotify's), as its ⋯ does.
    Modifier.fillMaxWidth().combinedClickable(onClick = onPlay, onLongClick = { if (menu.isNotEmpty()) Menus.open = "More for ${t.title}" to menu })
      .padding(horizontal = 16.dp, vertical = 8.dp),
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
  val token = rememberCoverToken()
  val r = if (round) 999.dp else look.art
  Column(
    (if (width != null) Modifier.width(width.dp) else Modifier).bouncy(label = title) {
      CoverFlight.token = token
      onClick()
    },
  ) {
    if (look.material != Material.Flat && !round)
      // A cover in a frame of the material, each a hair off-straight.
      Box(Modifier.fillMaxWidth().aspectRatio(1f).graphicsLayer { rotationZ = ((token.hashCode() % 5) - 2) * 0.4f }.matter(matter.paper, look.art, seed = token.hashCode(), depth = 0.9f).padding(7.dp).coverFrom(token).clip(RoundedCornerShape(look.rowArt))) {
        if (art != null) art() else Artwork(cover, title, null, radius = look.rowArt)
      }
    else
      Box(Modifier.fillMaxWidth().aspectRatio(1f).coverFrom(token).clip(RoundedCornerShape(r))) {
        if (art != null) art() else Artwork(cover, title, null, radius = r)
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
    Modifier.size(size.dp).clip(RoundedCornerShape(if (size > 100) look.page else look.rowArt)).background(Brush.linearGradient(listOf(Chamber.likedFrom, Chamber.likedTo))),
    contentAlignment = Alignment.Center,
  ) { Icon(EchoIcons.heartFilled, null, tint = Chamber.text, modifier = Modifier.size((size * 0.4f).dp)) }
}

@Composable
fun Shelf(title: String, content: LazyListScope.() -> Unit) {
  Column(Modifier.padding(top = 16.dp)) {
    Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      Text(title, style = MaterialTheme.typography.headlineSmall)
    }
    LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), content = content)
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
  val fallback = Chamber.headFallback
  val tint by produceState(fallback, albumKey) {
    value = albumKey?.let { app.palette.forAlbum(it) }?.let { headerTone(it.accentColor) } ?: fallback
  }
  return tint
}

fun Color.compositeOver(bg: Color): Color =
  Color(red * alpha + bg.red * (1 - alpha), green * alpha + bg.green * (1 - alpha), blue * alpha + bg.blue * (1 - alpha), 1f)

// ---- Home ----

@Composable
fun HomeScreen(nav: Nav, onProfile: () -> Unit) {
  val app = LocalContext.current.echo
  // ECHO can't be reached (v0.8): the downloads instead of shelves that can't load.
  if (!rememberOnline()) return OfflineHome(nav, onProfile)
  val playlists by app.library.playlistsFlow.collectAsStateWithLifecycle()
  val (recent, _) = load("recent") { app.library.albumList(AlbumList.Recent, 12) }
  val (newest, _) = load("newest") { app.library.albumList(AlbumList.Newest, 12) }
  val (frequent, _) = load("frequent") { app.library.albumList(AlbumList.Frequent, 12) }
  val (random, _) = load("random") { app.library.albumList(AlbumList.Random, 12) }
  val (mixes, _) = load("mixes") { app.library.mixes() }
  val (contexts, _) = load("contexts") { app.library.playedContexts() }
  val (karaoke, _) = load("karaoke") { app.library.karaokeSongs() }
  fun albums(l: Load<List<Album>>) = (l as? Load.Ok)?.value ?: emptyList()
  LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
    item { LargeTitle("Home") { Avatar(onProfile) } }
    // Guests: their time left and "Keep account"; for an inviter, a guest asking to stay.
    item("guest") {
      GuestBanner()
      KeepRequestsCard()
    }
    // The featured card: today's first mix, or else an album from the library.
    item("hero") {
      val mix = (mixes as? Load.Ok)?.value?.firstOrNull()
      val album = albums(recent).firstOrNull() ?: albums(random).firstOrNull()
      if (mix != null) HeroCard("Made for you", mix.title, mix.subtitle, mix.tracks.firstOrNull { it.cover != null }?.cover, mixColour(mix.id), { nav.go(Route.Mix(mix.id)) }) {
        app.playback.playList(mix.tracks.map { it.toTrack() }, 0, PlayContext("mix", mix.id, mix.title))
      }
      else if (album != null) HeroCard("Pick up where you left off", album.title, album.artist, album.cover, tintOf(album.key), { nav.go(Route.Album(album.id)) }) {
        app.scope.launch { app.library.loadAlbum(album.id)?.let { a -> app.playback.playList(a.tracks, 0, PlayContext("album", a.id, a.title)) } }
      }
    }
    for ((title, l) in listOf("Recently played" to recent, "New in your library" to newest)) {
      val list = albums(l)
      if (list.isNotEmpty()) item(title) { Shelf(title) { items(list, key = { it.id }) { a -> Card(a.cover, a.title, a.artist) { nav.go(Route.Album(a.id)) } } } }
    }
    madeForYou(mixes, contexts, nav)
    // Karaoke: songs whose karaoke version is ready; playing one turns Karaoke mode on.
    val sing = (karaoke as? Load.Ok)?.value ?: emptyList()
    if (sing.isNotEmpty())
      item("karaoke") {
        Shelf("Karaoke") {
          items(sing.size, key = { sing[it].key }) { i ->
            val t = sing[i]
            Card(t.cover, t.title, t.artist) {
              // All ready: they play as karaoke from the first note, not after a switch.
              for (x in sing) app.playback.karaokeReady(x.key, "/api/v1/karaoke/${java.net.URLEncoder.encode(x.id, "UTF-8")}/audio")
              app.karaoke.setOn(true)
              app.playback.playList(sing, i, PlayContext("karaoke", title = "Karaoke"))
            }
          }
        }
      }
    val pl = playlists ?: emptyList()
    if (pl.isNotEmpty()) item("playlists") { Shelf("Your playlists") { items(pl, key = { it.id }) { p -> Card(p.cover, p.name, p.owner ?: "${p.tracks} songs") { nav.go(Route.Playlist(p.id)) } } } }
    for ((title, l) in listOf("Your most played" to frequent, "Something different" to random)) {
      val list = albums(l)
      if (list.isNotEmpty()) item(title) { Shelf(title) { items(list, key = { it.id }) { a -> Card(a.cover, a.title, a.artist) { nav.go(Route.Album(a.id)) } } } }
    }
    val artists = albums(frequent).filter { it.artistId != null }.distinctBy { it.artistId }
    if (artists.size >= 2) item("artists") { Shelf("Artists you play") { items(artists, key = { it.artistId!! }) { a -> Card(a.cover, a.artist, "Artist", round = true) { nav.go(Route.Artist(a.artistId!!)) } } } }
  }
}

/** Home's featured card: the cover filling it under the colour, the kind, the title, a play button. */
@Composable
private fun HeroCard(kind: String, title: String, sub: String, cover: String?, colour: Color, onOpen: () -> Unit, onPlay: () -> Unit) {
  if (look.material != Material.Flat) return MadeHero(kind, title, sub, onOpen, onPlay)
  val api = LocalContext.current.echo.api
  Box(
    Modifier.padding(horizontal = 20.dp, vertical = 8.dp).fillMaxWidth().height(220.dp).bouncy(scale = 0.97f, label = title, onClick = onOpen).clip(RoundedCornerShape(look.hero)).background(colour),
  ) {
    if (cover != null) AsyncImage(api.url(cover.replace("size=300", "size=600")), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Transparent, 0.35f to colour.copy(alpha = 0.25f), 1f to colour.copy(alpha = 0.95f).compositeOver(Color.Black))))
    Column(Modifier.align(Alignment.BottomStart).padding(start = 20.dp, end = 84.dp, bottom = 18.dp)) {
      Text(kind.uppercase(), color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.labelMedium)
      Text(title, color = Color.White, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
      Text(sub, color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    Box(
      Modifier.align(Alignment.BottomEnd).padding(16.dp).size(52.dp).bouncy(scale = 0.88f, onClick = onPlay).clip(RoundedCornerShape(look.button.coerceAtMost(26.dp))).background(Color.White)
        .semantics { contentDescription = "Play $title" },
      contentAlignment = Alignment.Center,
    ) { Icon(EchoIcons.play, null, tint = colour.compositeOver(Color.Black), modifier = Modifier.size(24.dp)) }
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
    LargeTitle("Search")
    // A rounded, filled search field.
    Row(
      Modifier.padding(horizontal = 20.dp).fillMaxWidth().height(52.dp)
        .then(if (look.material != Material.Flat) Modifier.matter(matter.paper, 26.dp, pressed = true, seed = 60) else Modifier.clip(RoundedCornerShape(26.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)).padding(horizontal = 16.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(EchoIcons.search, null, tint = Chamber.muted, modifier = Modifier.size(22.dp))
      Spacer(Modifier.width(12.dp))
      Box(Modifier.weight(1f)) {
        if (q.isEmpty()) Text("Artists, songs, albums", color = Chamber.muted, style = MaterialTheme.typography.bodyLarge)
        BasicTextField(q, { q = it }, singleLine = true, textStyle = MaterialTheme.typography.bodyLarge.copy(color = Chamber.text), cursorBrush = SolidColor(MaterialTheme.colorScheme.primary), modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Search" })
      }
      if (q.isNotEmpty()) IconBtn(EchoIcons.close, "Clear search", Chamber.muted, 20) { q = "" }
    }
    when {
      q.isBlank() ->
        when (genres) {
          Load.Loading -> Loading()
          Load.Failed -> BlockError("Couldn't load genres.", retryGenres)
          is Load.Ok ->
            LazyVerticalGrid(GridCells.Fixed(2), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 168.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
              item(span = { GridItemSpan(maxLineSpan) }) { Text("Browse by genre", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(vertical = 6.dp)) }
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
            item { SectionTitle("Songs") }
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
  Box(Modifier.fillMaxWidth().height(110.dp).bouncy(label = g.name, onClick = onClick).clip(RoundedCornerShape(look.panel)).background(Brush.linearGradient(listOf(genreColour(g.name), genreColour(g.name).copy(alpha = 0.7f).compositeOver(Color.Black)))).padding(14.dp)) {
    Text(g.name, color = Color.White, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
    Text("${g.albums} album${if (g.albums == 1) "" else "s"}", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall, modifier = Modifier.align(Alignment.BottomStart))
  }
}

@Composable
fun GenreScreen(name: String, nav: Nav) {
  val app = LocalContext.current.echo
  val (state, retry) = load(name) { app.library.genreAlbums(name) }
  Column(Modifier.fillMaxSize()) {
    Box(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(genreColour(name), Chamber.surface1)))) {
      PageBar(nav)
      Text(name, color = Color.White, style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 16.dp, end = 20.dp))
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
    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 168.dp),
    horizontalArrangement = Arrangement.spacedBy(14.dp),
    verticalArrangement = Arrangement.spacedBy(20.dp),
    modifier = Modifier.fillMaxSize(),
  ) {
    items(albums, key = { it.id }) { a -> Card(a.cover, a.title, a.artist, width = null) { nav.go(Route.Album(a.id)) } }
  }
}

// ---- Library ----

/** Library: the categories as a list, then what was added lately (a two-column grid). */
@Composable
fun YourLibraryScreen(nav: Nav, onProfile: () -> Unit) {
  val app = LocalContext.current.echo
  val status by app.library.status.collectAsStateWithLifecycle()
  val playlists by app.library.playlistsFlow.collectAsStateWithLifecycle()
  val scope = rememberCoroutineScope()
  val (newest, _) = load("newest") { app.library.albumList(AlbumList.Newest, 12) }
  val online = rememberOnline()
  LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
    item {
      LargeTitle("Library") {
        IconBtn(EchoIcons.plus, "Create playlist", MaterialTheme.colorScheme.primary, 26) {
          scope.launch { runCatching { app.library.createPlaylist("My Playlist #${(playlists?.size ?: 0) + 1}") }.onSuccess { id -> if (id.isNotBlank()) nav.go(Route.Playlist(id)) } }
        }
        Avatar(onProfile)
      }
    }
    item { CategoryRow(EchoIcons.playlist, "Playlists") { nav.go(Route.LibraryList("playlists")) } }
    item { CategoryRow(EchoIcons.user, "Artists") { nav.go(Route.LibraryList("artists")) } }
    item { CategoryRow(EchoIcons.disc, "Albums") { nav.go(Route.LibraryList("albums")) } }
    item { CategoryRow(EchoIcons.heart, "Liked Songs") { nav.go(Route.Liked) } }
    item { CategoryRow(EchoIcons.download, "Downloads") { nav.go(Route.Downloads) } }
    if (!online) item { OfflineNote(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), onDownloads = { nav.go(Route.Downloads) }) }
    else if (status == Status.NotConnected) item { Empty("Nothing in your library yet. Connect a server in Settings on the web.") }
    else if (status == Status.Error) item { BlockError("Couldn't load your library.", app.library::reload) }
    val added = (newest as? Load.Ok)?.value.orEmpty()
    if (added.isNotEmpty()) {
      item { SectionTitle("Recently added", Modifier.padding(top = 8.dp)) }
      items(added.chunked(2), key = { row -> "added:" + row.joinToString { it.id } }) { row ->
        Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
          for (a in row) Box(Modifier.weight(1f)) { Card(a.cover, a.title, a.artist, width = null) { nav.go(Route.Album(a.id)) } }
          if (row.size == 1) Spacer(Modifier.weight(1f))
        }
      }
    }
  }
}

/** One of the library's lists: playlists, artists or albums (with the sorts). */
@Composable
fun LibraryListScreen(kind: String, nav: Nav) {
  val app = LocalContext.current.echo
  val albums by app.library.albums.collectAsStateWithLifecycle()
  val status by app.library.status.collectAsStateWithLifecycle()
  val sort by app.library.sort.collectAsStateWithLifecycle()
  val playlists by app.library.playlistsFlow.collectAsStateWithLifecycle()
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
    item { PageBar(nav) }
    item { LargeTitle(mapOf("playlists" to "Playlists", "artists" to "Artists", "albums" to "Albums")[kind] ?: kind) }
    when (kind) {
      "playlists" -> {
        item("liked") { LibRow({ LikedArt(56) }, "Liked Songs", "${starred?.tracks?.size ?: 0} songs") { nav.go(Route.Liked) } }
        items(playlists ?: emptyList(), key = { "p:${it.id}" }) { p ->
          LibRow({ if (p.cover != null) Artwork(p.cover, p.name, 56.dp) else EmptyArt(56) }, p.name, p.owner ?: "${p.tracks} songs") { nav.go(Route.Playlist(p.id)) }
        }
      }
      "artists" -> {
        if (status == Status.Loading && albums.isEmpty()) item { Loading() }
        val artists = albums.filter { it.artistId != null }.groupBy { it.artistId!! }.map { (id, l) -> Triple(id, l.first().artist.trim(), l.first().cover) }.sortedBy { it.second.lowercase() }
        items(artists, key = { "r:${it.first}" }) { (id, name, cover) ->
          LibRow({ Box(Modifier.size(56.dp).clip(CircleShape)) { Artwork(cover, name, 56.dp, radius = 28.dp) } }, name, "") { nav.go(Route.Artist(id)) }
        }
      }
      else -> {
        item {
          Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (s in AlbumSort.entries) Chip(s.label, s == sort) { app.library.setSort(s) }
          }
        }
        if (status == Status.Error && albums.isEmpty()) item { BlockError("Couldn't load your library.", app.library::reload) }
        if (status == Status.Loading && albums.isEmpty()) item { Loading() }
        items(albums.chunked(2), key = { row -> "a:" + row.joinToString { it.id } }) { row ->
          Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            for (a in row) Box(Modifier.weight(1f)) { Card(a.cover, a.title, a.artist, width = null) { nav.go(Route.Album(a.id)) } }
            if (row.size == 1) Spacer(Modifier.weight(1f))
          }
        }
      }
    }
  }
}

@Composable
private fun EmptyArt(size: Int) {
  Box(Modifier.size(size.dp).clip(RoundedCornerShape(if (size > 100) look.page else look.rowArt)).background(Chamber.surface3), contentAlignment = Alignment.Center) {
    Icon(EchoIcons.music, null, tint = Chamber.muted, modifier = Modifier.size((size * 0.45f).dp))
  }
}

@Composable
private fun LibRow(art: @Composable () -> Unit, title: String, sub: String, onClick: () -> Unit) {
  Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
    art()
    Column(Modifier.weight(1f)) {
      Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (sub.isNotEmpty()) Text(sub, color = Chamber.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Icon(EchoIcons.chevronRight, null, tint = Chamber.muted, modifier = Modifier.size(18.dp))
  }
}

// ---- Album, artist, playlist, Liked Songs ----

@Composable
fun AlbumScreen(id: String, nav: Nav, picker: (Track) -> Unit) {
  val app = LocalContext.current.echo
  val now = nowKey()
  // Offline, or ECHO away: the downloaded copy, when there is one (v0.8).
  val (state, retry) = load(id) { runCatching { app.library.loadAlbum(id) }.getOrElse { e -> app.downloads.album(id) ?: throw e } }
  val (live, playing) = contextLive("album", id)
  val download = rememberDownloadStatus("album", id)
  val starred by app.library.starredFlow.collectAsStateWithLifecycle()
  val scope = rememberCoroutineScope()
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load this album.", retry)
    is Load.Ok -> {
      val a = state.value ?: return Empty("This album is not in your library.")
      val ctx = PlayContext("album", a.id, a.title)
      val saved = starred?.albums?.any { it.id == a.id } == true
      val tracksMs = a.tracks.sumOf { it.durationMs }
      val accent = rememberAlbumAccent(a.key)
      LaunchedEffect(a) { app.downloads.sync("album", a.id, a.tracks) }
      AlbumAccent(accent) {
      LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
        item {
          AlbumWash(accent) {
          PageBar(nav) {
            Box(
              Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable {
                scope.launch { runCatching { app.library.setStar(StarKind.Album, a.id, !saved, album = a) } }
              }.semantics { contentDescription = if (saved) "Remove ${a.title} from your library" else "Add ${a.title} to your library" },
              contentAlignment = Alignment.Center,
            ) { Icon(if (saved) EchoIcons.check else EchoIcons.plus, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp)) }
            Spacer(Modifier.width(8.dp))
            if (a.tracks.isNotEmpty()) {
              DownloadButton("album", a.id, a.title) { app.downloads.download(a) }
              Spacer(Modifier.width(8.dp))
            }
            Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
              MoreMenu("More for ${a.title}", listOf("Add to queue" to { a.tracks.forEach(app.playback::addToQueue) }, downloadMenuItem(app, download, "album", a.id) { app.downloads.download(a) }))
            }
          }
          PageHeader(
            art = { Artwork(a.cover?.replace("size=300", "size=600"), a.title, null, Modifier.fillMaxSize(), radius = look.page) },
            title = a.title,
            subtitle = a.artist,
            meta = listOfNotNull("Album", a.year?.toString()).joinToString(" · "),
            onSubtitle = a.artistId?.let { { nav.go(Route.Artist(it)) } },
          )
          }
          PlayShuffle(a.title, live, playing, { app.playback.playList(a.tracks, 0, ctx) }, { app.playback.playList(a.tracks.shuffled(), 0, ctx) })
        }
        itemsIndexed(a.tracks, key = { i, t -> "$i:${t.key}" }) { i, t ->
          NumberedRow(i + 1, t, a.artist, t.key == now, { app.playback.playList(a.tracks, i, ctx) }, songMenu(app, t, nav, picker))
        }
        item {
          Text(
            "${a.tracks.size} song${if (a.tracks.size == 1) "" else "s"}, ${duration(tracksMs)}",
            color = Chamber.muted,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(start = 20.dp, top = 16.dp),
          )
        }
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
      AlbumAccent(rememberAlbumAccent(a.albums.firstOrNull()?.key)) {
      LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
        item {
          Box(Modifier.fillMaxWidth().height(300.dp)) {
            Artwork(i?.image ?: a.albums.firstOrNull()?.cover, a.name, null, Modifier.fillMaxSize(), radius = 0.dp)
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Chamber.surface1))))
            Text(a.name.trim(), style = MaterialTheme.typography.displayMedium, modifier = Modifier.align(Alignment.BottomStart).padding(20.dp))
            PageBar(nav)
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
}

@Composable
fun PlaylistScreen(id: String, nav: Nav, picker: (Track) -> Unit) {
  val app = LocalContext.current.echo
  val now = nowKey()
  var version by remember { mutableIntStateOf(0) }
  val (state, retry) = load("$id:$version") { runCatching { app.library.playlist(id) }.getOrElse { e -> app.downloads.playlist(id) ?: throw e } }
  val (live, playing) = contextLive("playlist", id)
  val download = rememberDownloadStatus("playlist", id)
  val scope = rememberCoroutineScope()
  var editing by remember { mutableStateOf(false) }
  var deleting by remember { mutableStateOf(false) }
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load this playlist.", retry)
    is Load.Ok -> {
      val p = state.value ?: return Empty("This playlist does not exist.")
      val ctx = PlayContext("playlist", id, p.playlist.name)
      val accent = rememberAlbumAccent(p.entries.firstOrNull()?.album?.key)
      LaunchedEffect(p) { app.downloads.sync("playlist", id, p.entries) }
      AlbumAccent(accent) {
      LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
        item {
          AlbumWash(accent) {
          PageBar(nav) {
            if (p.entries.isNotEmpty()) {
              DownloadButton("playlist", id, p.playlist.name) { app.downloads.download(p) }
              Spacer(Modifier.width(8.dp))
            }
            Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
              MoreMenu(
                "More for ${p.playlist.name}",
                listOf("Smart Shuffle" to { smartShuffle(app, scope, p.entries, ctx) }) +
                  (if (p.entries.isNotEmpty()) listOf(downloadMenuItem(app, download, "playlist", id) { app.downloads.download(p) }) else emptyList()) +
                  listOf("Edit details" to { editing = true }, "Delete" to { deleting = true }),
              )
            }
          }
          PageHeader(
            art = {
              if (p.covers.size >= 4)
                Column(Modifier.fillMaxSize().clip(RoundedCornerShape(look.page))) {
                  for (row in p.covers.take(4).chunked(2)) Row(Modifier.weight(1f)) { for (c in row) Box(Modifier.weight(1f)) { Artwork(c, p.playlist.name, null, Modifier.fillMaxSize(), radius = 0.dp) } }
                }
              else if (p.covers.isNotEmpty()) Artwork(p.covers.first(), p.playlist.name, null, Modifier.fillMaxSize(), radius = look.page)
              else EmptyArt(260)
            },
            title = p.playlist.name,
            subtitle = p.playlist.owner,
            meta = "${p.entries.size} songs · ${duration(p.durationMs)}",
          )
          }
          p.comment?.let { Text(it, color = Chamber.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) }
          if (p.entries.isNotEmpty()) PlayShuffle(p.playlist.name, live, playing, { app.playback.playList(p.entries, 0, ctx) }, { app.playback.playList(p.entries.shuffled(), 0, ctx) })
        }
        if (p.entries.isEmpty()) item { Empty("Let's find something for your playlist. Add songs from any song’s menu.") }
        itemsIndexed(p.entries, key = { n, t -> "$n:${t.key}" }) { n, t ->
          SongRow(t, t.key == now, { app.playback.playList(p.entries, n, ctx) }, true, songMenu(app, t, nav, picker, listOf("Remove from this playlist" to {
            scope.launch { runCatching { app.library.updatePlaylist(id, remove = listOf(n)) }.onSuccess { version++ } }
          })))
        }
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
          text = { Text("This will delete the playlist from your library.") },
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
  // Not loaded (offline): the downloaded Liked Songs, when there are (v0.8).
  val offline by app.downloads.index.collectAsStateWithLifecycle()
  val saved = offline.item("liked", "liked")?.tracks
  val tracks = starred?.tracks ?: saved ?: emptyList()
  val ctx = PlayContext("starred", title = "Liked Songs")
  val (live, playing) = contextLive("starred", null)
  val scope = rememberCoroutineScope()
  val download = rememberDownloadStatus("liked", "liked")
  val online = rememberOnline()
  LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
    item {
      PageBar(nav) {
        if (tracks.isNotEmpty()) {
          DownloadButton("liked", "liked", "Liked Songs") { app.downloads.downloadLiked(tracks) }
          Spacer(Modifier.width(8.dp))
        }
        Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
          MoreMenu(
            "More for Liked Songs",
            listOf("Smart Shuffle" to { smartShuffle(app, scope, tracks, ctx) }) +
              (if (tracks.isNotEmpty()) listOf(downloadMenuItem(app, download, "liked", "liked") { app.downloads.downloadLiked(tracks) }) else emptyList()),
          )
        }
      }
      PageHeader(art = { LikedArt(260) }, title = "Liked Songs", subtitle = null, meta = "${tracks.size} songs")
      if (tracks.isNotEmpty()) PlayShuffle("Liked Songs", live, playing, { app.playback.playList(tracks, 0, ctx) }, { app.playback.playList(tracks.shuffled(), 0, ctx) })
    }
    if (starred == null && saved == null) item { if (online) Loading() else Empty("You're offline. Download Liked Songs to play them with no connection.") }
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

/** Home's featured card in clay or yarn: a slab of the material, a label, the title, a play button. */
@Composable
internal fun MadeHero(kind: String, title: String, sub: String, onOpen: () -> Unit, onPlay: () -> Unit) {
  val fill = matter.accent(0)
  val ink = inkOn(fill, matter.ink)
  val (source, down) = rememberPress()
  Box(Modifier.padding(horizontal = 20.dp, vertical = 10.dp).fillMaxWidth().height(184.dp).graphicsLayer { rotationZ = -0.6f }.bouncy(scale = 0.98f, source = source, label = title, onClick = onOpen).matter(fill, look.hero, pressed = down, seed = 3, depth = 1.3f)) {
    Text(
      kind.uppercase(),
      color = inkOn(matter.paper, matter.ink),
      style = MaterialTheme.typography.labelSmall,
      modifier = Modifier.padding(18.dp).matter(matter.paper, 12.dp, seed = 5, depth = 0.5f).padding(horizontal = 10.dp, vertical = 5.dp),
    )
    // Retro hi-fi: the panel's meters move with what's playing. Paper: the card is taped down.
    if (look.material == Material.HiFi) VuMeters(Modifier.align(Alignment.TopEnd).padding(top = 16.dp, end = 18.dp).width(136.dp))
    if (look.material == Material.Paper) Tape(Modifier.align(Alignment.TopCenter).offset(y = (-9).dp))
    Column(Modifier.align(Alignment.BottomStart).padding(start = 20.dp, end = 86.dp, bottom = 20.dp)) {
      Text(title, color = ink, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
      Text(sub, color = ink.copy(alpha = 0.8f), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    val (ps, pd) = rememberPress()
    Box(
      Modifier.align(Alignment.BottomEnd).padding(18.dp).size(56.dp).bouncy(scale = 0.9f, source = ps, label = "Play $title", onClick = onPlay).matter(matter.paper, 22.dp, pressed = pd, seed = 6),
      contentAlignment = Alignment.Center,
    ) { Icon(EchoIcons.play, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp)) }
  }
}
