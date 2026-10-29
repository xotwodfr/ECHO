package com.folk3s.echo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.Mix
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.PlayedContext
import com.folk3s.echo.api.Track
import com.folk3s.echo.api.Wrapped
import com.folk3s.echo.echo
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Calendar
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// Made For You (project 2 of the Spotify redesign; the web's MixViews.tsx and HomeView.tsx): Home's
// Made For You and Jump back in shelves, a mix's screen and Wrapped, all from ECHO's play history.

private val HUES = mapOf("discover" to 7, "on-repeat" to 0, "rewind" to 1, "daylist" to 11)

/** Each kind of mix keeps its colour, as on the web; the Daily Mixes take one each. */
fun mixColour(id: String): Color =
  Color(GENRE_COLOURS[HUES[id] ?: (((id.filter(Char::isDigit).toIntOrNull() ?: 0) * 2 + 2) % GENRE_COLOURS.size)])

private val GREY = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) })

/** A mix's cover: its first song's cover in grey over the mix's colour, the mix's name over it. */
@Composable
fun MixArt(title: String, cover: String?, colour: Color, size: Dp? = null) {
  val api = LocalContext.current.echo.api
  BoxWithConstraints(
    (if (size != null) Modifier.size(size) else Modifier.fillMaxWidth().aspectRatio(1f)).clip(RoundedCornerShape(6.dp)).background(colour),
  ) {
    if (cover != null)
      AsyncImage(api.url(cover), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alpha = 0.55f, colorFilter = GREY)
    Text(
      title,
      color = Chamber.text,
      fontFamily = Figtree,
      fontWeight = FontWeight.ExtraBold,
      fontSize = (maxWidth.value * 0.14f).sp,
      lineHeight = (maxWidth.value * 0.145f).sp,
      modifier = Modifier.align(Alignment.BottomStart).padding(maxWidth * 0.07f),
    )
  }
}

@Composable
private fun MixArt(mix: Mix, size: Dp? = null) = MixArt(mix.title, mix.tracks.firstOrNull { it.cover != null }?.cover, mixColour(mix.id), size)

/** Home's two shelves from the history: Made For You (and this year's Wrapped), Jump back in. */
fun LazyListScope.madeForYou(mixes: Load<List<Mix>>, contexts: Load<List<PlayedContext>>, nav: Nav) {
  val list = (mixes as? Load.Ok)?.value.orEmpty()
  if (list.isNotEmpty()) {
    val year = Calendar.getInstance().get(Calendar.YEAR)
    item("mixes") {
      Shelf("Made For You") {
        items(list, key = { it.id }) { m ->
          Card(null, m.title, m.subtitle, art = { MixArt(m) }) { nav.go(Route.Mix(m.id)) }
        }
        item("wrapped") {
          Card(null, "Your $year Wrapped", "Your year in music", art = { MixArt("Wrapped $year", null, Color(GENRE_COLOURS[8])) }) {
            nav.go(Route.Wrapped(year))
          }
        }
      }
    }
  }
  val jump = (contexts as? Load.Ok)?.value.orEmpty()
  if (jump.size >= 2)
    item("jump") {
      Shelf("Jump back in") {
        items(jump, key = { "${it.kind}:${it.id}" }) { x ->
          val mix = if (x.kind == "mix") list.firstOrNull { it.id == x.id } else null
          val kind = mapOf("album" to "Album", "playlist" to "Playlist", "artist" to "Artist", "mix" to "Made For You")[x.kind] ?: x.kind
          Card(x.cover, x.title ?: "", kind, round = x.kind == "artist", art = mix?.let { { MixArt(it) } }) {
            when (x.kind) {
              "album" -> nav.go(Route.Album(x.id))
              "playlist" -> nav.go(Route.Playlist(x.id))
              "artist" -> nav.go(Route.Artist(x.id))
              "mix" -> nav.go(Route.Mix(x.id))
            }
          }
        }
      }
    }
}

/** Smart Shuffle (Library.smartShuffle): plays, and says how many recommendations it mixed in. */
fun smartShuffle(app: EchoApp, scope: CoroutineScope, tracks: List<Track>, ctx: PlayContext) {
  scope.launch {
    val (list, added) = app.library.smartShuffle(tracks)
    app.playback.playList(list, 0, ctx)
    app.playback.notify(if (added > 0) "Smart Shuffle: $added recommendation${if (added == 1) "" else "s"} mixed in" else "Shuffling")
  }
}

@Composable
fun MixScreen(id: String, nav: Nav, picker: (Track) -> Unit) {
  val app = LocalContext.current.echo
  val now = nowKey()
  val (state, retry) = load("mixes") { app.library.mixes() }
  val (live, playing) = contextLive("mix", id)
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load your mixes.", retry)
    is Load.Ok -> {
      val mix = state.value.firstOrNull { it.id == id } ?: return Empty("This mix isn’t here today. Mixes are made from what you play, and change every day.")
      val tracks = remember(mix) { mix.tracks.map { it.toTrack() } }
      val ctx = PlayContext("mix", id, mix.title)
      LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
        item {
          TintedHeader(mixColour(id)) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { MixArt(mix, 240.dp) }
            Spacer(Modifier.height(16.dp))
            Text(mix.title, style = MaterialTheme.typography.headlineMedium)
            Text("${mix.subtitle} • ${tracks.size} songs", color = Chamber.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
          }
          Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.weight(1f))
            IconBtn(EchoIcons.shuffle, "Shuffle ${mix.title}") { app.playback.playList(tracks.shuffled(), 0, ctx) }
            PlayFab(mix.title, live, playing, { app.playback.playList(tracks, 0, ctx) })
          }
        }
        itemsIndexed(tracks, key = { n, t -> "$n:${t.key}" }) { n, t -> SongRow(t, t.key == now, { app.playback.playList(tracks, n, ctx) }, true, songMenu(app, t, nav, picker)) }
      }
    }
  }
}

private val DAY = DateTimeFormatter.ofPattern("EEEE, MMMM d")

@Composable
fun WrappedScreen(year: Int, nav: Nav) {
  val app = LocalContext.current.echo
  val (state, retry) = load(year) { app.library.wrapped(year) }
  val ctx = PlayContext("mix", "wrapped-$year", "Your Top Songs $year")
  val (live, playing) = contextLive("mix", ctx.id)
  when (state) {
    Load.Loading -> Loading()
    Load.Failed -> BlockError("Couldn't load your Wrapped.", retry)
    is Load.Ok -> {
      val w: Wrapped = state.value
      if (w.plays == 0) return Empty("Nothing played in $year yet. Wrapped is made from what you play in ECHO.")
      val tracks = remember(w) { w.tracks.map { it.toTrack() } }
      LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), contentPadding = BottomRoom, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
          Column(
            Modifier.padding(top = 16.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp))
              .background(Brush.linearGradient(listOf(Color(GENRE_COLOURS[8]), Color(GENRE_COLOURS[2])))).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Text("Wrapped", style = MaterialTheme.typography.labelLarge)
            Text("Your $year Wrapped", style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.ExtraBold))
            Figure("%,d".format(w.minutes), "Minutes listened")
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              PlayFab(ctx.title, live, playing, { app.playback.playList(tracks, 0, ctx) })
              Text(ctx.title, fontWeight = FontWeight.Bold)
            }
          }
        }
        item {
          WrappedCard("Your top artists", GENRE_COLOURS[0]) {
            w.artists.forEachIndexed { i, a ->
              Ranked(i, a.name, "${a.plays} plays", null, a.id?.let { id -> { nav.go(Route.Artist(id)) } })
            }
          }
        }
        item {
          WrappedCard("Your top songs", GENRE_COLOURS[7]) {
            w.tracks.take(5).forEachIndexed { i, t -> Ranked(i, t.title, t.artist, t.cover, null) }
          }
        }
        item {
          WrappedCard("Your top albums", GENRE_COLOURS[4]) {
            w.albums.forEachIndexed { i, a -> Ranked(i, a.title, a.artist, a.cover, a.id?.let { id -> { nav.go(Route.Album(id)) } }) }
          }
        }
        item {
          WrappedCard("Your biggest day", GENRE_COLOURS[5]) {
            w.topDay?.let { Figure(LocalDate.parse(it.date).format(DAY), "${it.plays} plays") }
            Figure("%,d".format(w.distinctArtists), "Artists you played")
          }
        }
        item {
          Text(
            "${year - 1} Wrapped",
            color = Chamber.text,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(Chamber.surface3).clickable { nav.go(Route.Wrapped(year - 1)) }
              .padding(horizontal = 16.dp, vertical = 10.dp),
          )
        }
      }
    }
  }
}

@Composable
private fun Figure(big: String, label: String) {
  Column {
    Text(big, style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold))
    Text(label, color = Chamber.text.copy(alpha = 0.8f), style = MaterialTheme.typography.bodyMedium)
  }
}

@Composable
private fun WrappedCard(title: String, colour: Long, content: @Composable () -> Unit) {
  Column(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
      .background(Brush.verticalGradient(listOf(Color(colour), Color(colour).copy(alpha = 0.55f).compositeOver(Chamber.ground)))).padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Text(title, style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
    content()
  }
}

@Composable
private fun Ranked(i: Int, title: String, sub: String, cover: String?, onClick: (() -> Unit)?) {
  Row(
    (if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Text("${i + 1}", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold), modifier = Modifier.width(20.dp))
    if (cover != null) Artwork(cover, title, 48.dp)
    Column {
      Text(title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(sub, color = Chamber.text.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
  }
}
