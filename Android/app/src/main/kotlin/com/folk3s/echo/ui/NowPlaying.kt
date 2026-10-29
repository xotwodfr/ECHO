package com.folk3s.echo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.Track
import com.folk3s.echo.echo
import com.folk3s.echo.playback.PlayerState
import com.folk3s.echo.playback.Repeat
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Spotify's Now Playing screen: the album's tone fading to black, "Playing from", the big cover,
// the song with its heart, the seek bar, the transport with the white play disc, and the lyrics
// card that opens the lyrics view.

private val FROM = mapOf("album" to "ALBUM", "playlist" to "PLAYLIST", "starred" to "LIKED SONGS", "search" to "SEARCH", "radio" to "RADIO", "artist" to "ARTIST")

/** Spotify's sleep timer: pause after some minutes. One at a time; a new one replaces it. */
object SleepTimer {
  private var job: Job? = null
  var minutes by mutableStateOf<Int?>(null)

  fun set(app: EchoApp, m: Int?) {
    job?.cancel()
    minutes = m
    if (m == null) return app.playback.notify("Sleep timer turned off")
    app.playback.notify("Sleep timer set: $m minutes")
    job =
      app.scope.launch {
        delay(m * 60_000L)
        if (app.playback.state.value.playing) app.playback.toggle()
        minutes = null
        app.playback.notify("Sleep timer: paused")
      }
  }
}

@Composable
fun NowPlayingScreen(p: PlayerState, nav: Nav, onQueue: () -> Unit, picker: (Track) -> Unit) {
  val app = LocalContext.current.echo
  val ctx by app.playback.context.collectAsStateWithLifecycle()
  val t = p.track
  val tone = headerTone(albumAccent())
  if (t == null) {
    LaunchedEffect(Unit) { nav.back() }
    return
  }
  Column(
    Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(tone, tone.copy(alpha = 0.55f).compositeOverGround(), Chamber.ground)))
      .windowInsetsPadding(WindowInsets.statusBars).windowInsetsPadding(WindowInsets.navigationBars).verticalScroll(rememberScrollState()),
  ) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      IconBtn(EchoIcons.chevronDown, "Close Now playing", Chamber.text, 28) { nav.back() }
      Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("PLAYING FROM ${FROM[ctx?.kind] ?: "YOUR LIBRARY"}", color = Chamber.text.copy(alpha = 0.75f), style = MaterialTheme.typography.labelSmall)
        Text(ctx?.title ?: t.album.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
      }
      MoreMenu(
        "More for ${t.title}",
        songMenu(app, t, nav, picker) +
          listOf(15, 30, 45, 60).map { m -> "Sleep timer: $m minutes" to { SleepTimer.set(app, m) } } +
          (if (SleepTimer.minutes != null) listOf("Turn off sleep timer" to { SleepTimer.set(app, null) }) else emptyList()),
      )
    }
    Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 24.dp).aspectRatio(1f)) {
      Artwork(t.cover?.replace("size=600", "size=900"), t.album.title, null, Modifier.fillMaxSize(), radius = 8.dp)
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(t.title, style = MaterialTheme.typography.headlineSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { t.album.id?.let { nav.go(Route.Album(it)) } })
        Text(t.artist, color = Chamber.text.copy(alpha = 0.75f), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { t.artists.firstOrNull()?.id?.let { nav.go(Route.Artist(it)) } })
      }
      Heart(t, 28)
    }
    SeekBar(p)
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
      IconBtn(EchoIcons.shuffle, "Shuffle", if (p.shuffle) Chamber.green else Chamber.text, 26) { app.playback.toggleShuffle() }
      IconBtn(EchoIcons.previous, "Previous", Chamber.text, 34) { app.playback.previous() }
      PlayButton(p.playing, enabled = true, onClick = app.playback::toggle, size = 68)
      IconBtn(EchoIcons.next, "Next", Chamber.text, 34) { app.playback.next() }
      IconBtn(if (p.repeat == Repeat.One) EchoIcons.repeatOne else EchoIcons.repeat, "Repeat", if (p.repeat != Repeat.Off) Chamber.green else Chamber.text, 26) { app.playback.cycleRepeat() }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      IconBtn(EchoIcons.mic, "Lyrics", Chamber.text, 22) { nav.go(Route.Listen) }
      Spacer(Modifier.weight(1f))
      if (SleepTimer.minutes != null) Icon(EchoIcons.moon, "Sleep timer on", tint = Chamber.green, modifier = Modifier.size(20.dp))
      IconBtn(EchoIcons.queue, "Queue", Chamber.text, 22, onQueue)
    }
    LyricsCard(p, tone) { nav.go(Route.Listen) }
    Spacer(Modifier.height(32.dp))
  }
}

private fun androidx.compose.ui.graphics.Color.compositeOverGround() =
  androidx.compose.ui.graphics.Color(red * alpha, green * alpha, blue * alpha, 1f)

/** The seek bar: white on grey, the times under it; dragging seeks on release. */
@Composable
private fun SeekBar(p: PlayerState) {
  val app = LocalContext.current.echo
  var now by remember { mutableLongStateOf(p.positionNow()) }
  LaunchedEffect(p) {
    while (true) {
      now = p.positionNow()
      delay(250)
    }
  }
  var dragging by remember { mutableStateOf(false) }
  var dragValue by remember { mutableFloatStateOf(0f) }
  val d = p.durationMs.coerceAtLeast(1)
  val value = if (dragging) dragValue else (now.toFloat() / d).coerceIn(0f, 1f)
  Column(Modifier.padding(horizontal = 24.dp, vertical = 12.dp)) {
    // Spotify's seek bar: a thin white line on grey with a round thumb; tap or drag to seek.
    Box(
      Modifier.fillMaxWidth().height(24.dp)
        .semantics { contentDescription = "Seek" }
        .pointerInput(d) {
          detectTapGestures { o -> app.playback.seek(((o.x / size.width).coerceIn(0f, 1f) * d).toLong()) }
        }
        .pointerInput(d) {
          detectHorizontalDragGestures(
            onDragStart = { o ->
              dragging = true
              dragValue = (o.x / size.width).coerceIn(0f, 1f)
            },
            onDragEnd = {
              app.playback.seek((dragValue * d).toLong())
              dragging = false
            },
            onDragCancel = { dragging = false },
          ) { change, _ -> dragValue = (change.position.x / size.width).coerceIn(0f, 1f) }
        }
        .drawBehind {
          val y = size.height / 2
          val h = 4.dp.toPx()
          drawRoundRect(Chamber.text.copy(alpha = 0.25f), Offset(0f, y - h / 2), Size(size.width, h), CornerRadius(h / 2))
          drawRoundRect(Chamber.text, Offset(0f, y - h / 2), Size(size.width * value, h), CornerRadius(h / 2))
          drawCircle(Chamber.text, 6.dp.toPx(), Offset(size.width * value, y))
        },
    )
    Row(Modifier.fillMaxWidth()) {
      Text(duration((value * d).toLong()), color = Chamber.text.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall)
      Spacer(Modifier.weight(1f))
      Text(duration(p.durationMs), color = Chamber.text.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall)
    }
  }
}

/** Spotify's lyrics card: the line being sung on the album's tone; it opens the lyrics view. */
@Composable
private fun LyricsCard(p: PlayerState, tone: androidx.compose.ui.graphics.Color, onOpen: () -> Unit) {
  val app = LocalContext.current.echo
  val ls by app.lyrics.state.collectAsStateWithLifecycle()
  val doc = ls.doc ?: return
  var now by remember { mutableLongStateOf(p.positionNow()) }
  LaunchedEffect(p) {
    while (true) {
      now = p.positionNow()
      delay(300)
    }
  }
  val lines = doc.lines.filter { it.text.isNotBlank() }
  val at = if (doc.sync == "none") 0 else lines.indexOfLast { it.start <= now }.coerceAtLeast(0)
  Column(
    Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(tone).clickable(onClick = onOpen).padding(16.dp),
  ) {
    Text("Lyrics", style = MaterialTheme.typography.titleMedium)
    Spacer(Modifier.height(12.dp))
    for ((i, l) in lines.drop(at).take(4).withIndex()) {
      Text(l.text, style = MaterialTheme.typography.headlineSmall, color = if (i == 0) Chamber.text else Chamber.ground.copy(alpha = 0.7f), modifier = Modifier.padding(vertical = 2.dp))
    }
  }
}
