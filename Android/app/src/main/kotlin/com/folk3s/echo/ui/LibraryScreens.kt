package com.folk3s.echo.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.api.Album
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.Playlist
import com.folk3s.echo.api.Track
import com.folk3s.echo.echo
import com.folk3s.echo.library.AlbumSort
import com.folk3s.echo.library.ArtistPage
import com.folk3s.echo.library.SearchResult
import com.folk3s.echo.library.Status
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

enum class LibraryTab(val label: String) { Albums("Albums"), Artists("Artists"), Playlists("Playlists"), Starred("Starred") }

/** One screen's load: loading, the value, not there (null), or failed (Retry). */
private sealed interface Load<out T> {
  data object Loading : Load<Nothing>
  data class Ok<T>(val value: T) : Load<T>
  data object Failed : Load<Nothing>
}

@Composable
private fun <T> load(key: Any?, fetch: suspend () -> T): Pair<Load<T>, () -> Unit> {
  var attempt by remember { mutableIntStateOf(0) }
  var state by remember(key) { mutableStateOf<Load<T>>(Load.Loading) }
  LaunchedEffect(key, attempt) {
    state = Load.Loading
    state = runCatching { fetch() }.fold({ Load.Ok(it) }, { Load.Failed })
  }
  return state to { attempt++ }
}

@Composable
private fun ScreenTitle(text: String) {
  Text(text, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 8.dp))
}

/** Plays a list from one of its tracks, with the queue's "Then, from …" source. */
@Composable
private fun player() = LocalContext.current.echo.playback

@Composable
private fun nowKey(): String? {
  val s by player().state.collectAsStateWithLifecycle()
  return s.track?.key
}

private fun trackMenu(app: com.folk3s.echo.EchoApp, t: Track) =
  listOf("Play next" to { app.playback.playNext(t) }, "Add to queue" to { app.playback.addToQueue(t) })

@Composable
fun LibraryScreen(tab: LibraryTab, nav: Nav) {
  val app = LocalContext.current.echo
  Column(Modifier.fillMaxSize()) {
    ScreenTitle("Library")
    SecondaryTabRow(selectedTabIndex = tab.ordinal, containerColor = MaterialTheme.colorScheme.surface) {
      for (t in LibraryTab.entries) Tab(selected = t == tab, onClick = { nav.replace(Route.Library(t)) }, text = { Text(t.label) })
    }
    when (tab) {
      LibraryTab.Albums -> Albums(nav)
      LibraryTab.Artists -> Artists(nav)
      LibraryTab.Playlists -> Playlists()
      LibraryTab.Starred -> TrackListScreen(app.library::starred, "Nothing starred yet.", "Couldn't load starred tracks.", PlayContext("starred", title = "Starred"))
    }
  }
}

@Composable
private fun Albums(nav: Nav) {
  val lib = LocalContext.current.echo.library
  val albums by lib.albums.collectAsStateWithLifecycle()
  val status by lib.status.collectAsStateWithLifecycle()
  val sort by lib.sort.collectAsStateWithLifecycle()
  Column {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      for (s in AlbumSort.entries) FilterChip(selected = s == sort, onClick = { lib.setSort(s) }, label = { Text(s.label) })
    }
    when {
      status == Status.NotConnected -> Empty("Nothing in your library yet. Connect a server in Settings on the web.")
      status == Status.Loading && albums.isEmpty() -> Loading()
      status == Status.Error && albums.isEmpty() -> BlockError("Couldn't load your library.", lib::reload)
      albums.isEmpty() -> Empty("Nothing in your library yet.")
      else -> AlbumGrid(albums, nav)
    }
  }
}

@Composable
fun AlbumGrid(albums: List<Album>, nav: Nav, header: (@Composable () -> Unit)? = null) {
  LazyVerticalGrid(
    columns = GridCells.Adaptive(132.dp),
    contentPadding = PaddingValues(16.dp),
    horizontalArrangement = Arrangement.spacedBy(16.dp),
    verticalArrangement = Arrangement.spacedBy(20.dp),
    modifier = Modifier.fillMaxSize(),
  ) {
    if (header != null) item(span = { GridItemSpan(maxLineSpan) }) { header() }
    items(albums, key = { it.id }) { a -> AlbumTile(a) { nav.go(Route.Album(a.id)) } }
  }
}

/** Album tile (§9.4): the cover at tile width, title and artist below it, never on the art. */
@Composable
fun AlbumTile(a: Album, onOpen: () -> Unit) {
  // The state layer's 20 dp surround (§0) is padded, so its corners never cut into the text.
  Column(Modifier.clip(RoundedCornerShape(20.dp)).clickable(onClick = onOpen).padding(6.dp)) {
    Artwork(a.cover, a.title, null)
    Spacer(Modifier.height(8.dp))
    Text(a.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
    Text(a.artist, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

@Composable
private fun Artists(nav: Nav) {
  val lib = LocalContext.current.echo.library
  val albums by lib.albums.collectAsStateWithLifecycle()
  val status by lib.status.collectAsStateWithLifecycle()
  if (status == Status.Loading) return Loading()
  // Derived from the album list, by id where Navidrome has one (each row opens the artist's page).
  val artists =
    albums
      .groupBy { it.artistId ?: "name:${it.artist}" }
      .map { (_, list) -> Triple(list.first().artist.trim(), list.first().artistId, list.size) }
      .sortedBy { it.first.lowercase() }
  if (artists.isEmpty()) return Empty("No artists yet.")
  LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
    items(artists) { (name, id, n) ->
      Row(
        Modifier.fillMaxWidth().then(if (id != null) Modifier.clickable { nav.go(Route.Artist(id)) } else Modifier).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text("$n album${if (n == 1) "" else "s"}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
      }
    }
  }
}

@Composable
private fun Playlists() {
  val app = LocalContext.current.echo
  val (state, retry) = load(Unit) { app.library.playlists() }
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load playlists.", retry)
    is Load.Ok ->
      if (state.value.isEmpty()) Empty("No playlists on this server yet.")
      else
        LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
          items(state.value, key = { it.id }) { p ->
            var busy by remember { mutableStateOf(false) }
            Row(
              Modifier.fillMaxWidth().clickable(enabled = !busy) {
                busy = true
                app.scope.launchCatching {
                  app.playback.playList(app.library.playlistTracks(p.id), 0, PlayContext("playlist", p.id, p.name))
                }.invokeOnCompletion { busy = false }
              }.padding(horizontal = 16.dp, vertical = 14.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Text(p.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
              Text("${p.tracks} track${if (p.tracks == 1) "" else "s"}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
          }
        }
  }
}

private fun kotlinx.coroutines.CoroutineScope.launchCatching(block: suspend () -> Unit) =
  launch { runCatching { block() } }

@Composable
private fun TrackListScreen(fetch: suspend () -> List<Track>, empty: String, failed: String, ctx: PlayContext) {
  val app = LocalContext.current.echo
  val now = nowKey()
  val (state, retry) = load(ctx) { fetch() }
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError(failed, retry)
    is Load.Ok ->
      if (state.value.isEmpty()) Empty(empty)
      else
        LazyColumn(contentPadding = PaddingValues(8.dp)) {
          itemsIndexed(state.value) { i, t ->
            TrackRow(t, null, t.key == now, { app.playback.playList(state.value, i, ctx) }, showArt = true, menu = trackMenu(app, t))
          }
        }
  }
}

/** S6 Album detail: the cover (240 dp), its facts, Play and Shuffle, the tracks. */
@Composable
fun AlbumScreen(id: String, nav: Nav) {
  val app = LocalContext.current.echo
  val now = nowKey()
  val (state, retry) = load(id) { app.library.loadAlbum(id) }
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load this album.", retry)
    is Load.Ok -> {
      val a = state.value ?: return Empty("This album is not in your library.")
      val ctx = PlayContext("album", a.id, a.title)
      LazyColumn(contentPadding = PaddingValues(16.dp)) {
        item {
          Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Artwork(a.cover?.replace("size=300", "size=600"), a.title, 240.dp, radius = 8.dp)
            Spacer(Modifier.height(10.dp))
            Text(a.title, style = MaterialTheme.typography.headlineLarge)
            if (a.artistId != null) {
              TextButton(onClick = { nav.go(Route.Artist(a.artistId)) }, contentPadding = PaddingValues(0.dp)) {
                Text(a.artist, style = MaterialTheme.typography.titleMedium)
              }
            } else Text(a.artist, style = MaterialTheme.typography.titleMedium)
            val facts = listOfNotNull(a.year?.toString(), "${a.tracks.size} track${if (a.tracks.size == 1) "" else "s"}")
            Text(facts.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 12.dp)) {
              Button(onClick = { app.playback.playList(a.tracks, 0, ctx) }, enabled = a.tracks.isNotEmpty()) {
                Icon(EchoIcons.play, null, Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text("Play")
              }
              OutlinedButton(
                onClick = { app.playback.playList(a.tracks.shuffled(), 0, ctx) },
                enabled = a.tracks.isNotEmpty(),
              ) { Text("Shuffle") }
            }
          }
        }
        itemsIndexed(a.tracks, key = { i, t -> "$i:${t.key}" }) { i, t ->
          TrackRow(t, i + 1, t.key == now, { app.playback.playList(a.tracks, i, ctx) }, menu = trackMenu(app, t))
        }
      }
    }
  }
}

@Composable
fun ArtistScreen(id: String, nav: Nav) {
  val app = LocalContext.current.echo
  val (state, retry) = load(id) { app.library.artist(id) }
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load this artist.", retry)
    is Load.Ok -> {
      val a = state.value ?: return Empty("This artist is not in your library.")
      AlbumGrid(a.albums, nav) { Text(a.name, style = MaterialTheme.typography.headlineLarge) }
    }
  }
}

/** Search: what is loaded filters at once; the server's search3 joins a moment later. */
@Composable
fun SearchScreen(nav: Nav) {
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
  val local = app.library.search(q)
  val tracks = (local.tracks + (remote?.tracks ?: emptyList())).distinctBy { it.key }.take(50)
  val albums = (local.albums + (remote?.albums ?: emptyList())).distinctBy { it.id }
  Column(Modifier.fillMaxSize()) {
    ScreenTitle("Search")
    OutlinedTextField(q, { q = it }, placeholder = { Text("Search") }, singleLine = true, shape = RoundedCornerShape(28.dp), modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
    when {
      q.isBlank() -> Empty("Type to search your library.")
      tracks.isEmpty() && albums.isEmpty() && (remote != null || failed) -> Empty(if (failed) "Search didn't answer." else "No results for “${q.trim()}”.")
      else ->
        LazyColumn(contentPadding = PaddingValues(8.dp)) {
          if (albums.isNotEmpty()) {
            item { SectionLabel("Albums") }
            items(albums.take(12), key = { "a:${it.id}" }) { a ->
              Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { nav.go(Route.Album(a.id)) }.padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
              ) {
                Artwork(a.cover, a.title, 40.dp)
                Column {
                  Text(a.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                  Text(a.artist, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
              }
            }
          }
          if (tracks.isNotEmpty()) {
            item { SectionLabel("Tracks") }
            itemsIndexed(tracks, key = { _, t -> "t:${t.key}" }) { i, t ->
              TrackRow(t, null, t.key == now, { app.playback.playList(tracks, i, PlayContext("search", title = "“${q.trim()}”")) }, showArt = true, menu = trackMenu(app, t))
            }
          }
        }
    }
  }
}

@Composable
fun SectionLabel(text: String) {
  Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 8.dp, top = 16.dp, bottom = 8.dp))
}
