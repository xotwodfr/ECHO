package com.folk3s.echo.ui

import androidx.compose.foundation.background
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.width
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import com.folk3s.echo.api.toArgb
import com.folk3s.echo.stage.stagePalette
import kotlin.math.PI
import kotlin.math.sin
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

// Now Playing (v0.2): the album's colours drifting behind a big rounded cover that sits back while
// paused, the song with its heart and menu, the wavy seek bar, the transport with the big play
// button, Lyrics and Up next, and the lyrics card that opens the lyrics view.

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
  if (t == null) {
    LaunchedEffect(Unit) { nav.back() }
    return
  }
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  val still = app.prefs.reducedMotion(prefs)
  // The cover sits back a little while paused, and springs forward on play.
  val scale by animateFloatAsState(if (p.playing || still) 1f else 0.84f, spring(dampingRatio = 0.62f, stiffness = 260f), label = "cover")
  Box(Modifier.fillMaxSize()) {
    if (look.material != Material.Flat) Box(Modifier.fillMaxSize().matterGround(lerp(matter.ground, matter.accent(0), 0.22f))) else AlbumMesh(still)
    Column(
      Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars).windowInsetsPadding(WindowInsets.navigationBars).verticalScroll(rememberScrollState()),
    ) {
      // The grabber: swipe down (or tap) to close.
      Box(
        Modifier.fillMaxWidth().height(36.dp).swipes(down = { nav.back() }).clickable { nav.back() }.semantics { contentDescription = "Close Now playing" },
        contentAlignment = Alignment.Center,
      ) { Box(Modifier.size(width = 40.dp, height = 5.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.45f))) }
      Text(
        "Playing from ${FROM[ctx?.kind]?.lowercase()?.replaceFirstChar { it.uppercase() } ?: "your library"} · ${ctx?.title ?: t.album.title}",
        color = Color.White.copy(alpha = 0.7f),
        style = MaterialTheme.typography.labelMedium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp),
      )
      // Swipe sideways on the cover changes the song; down closes.
      Box(
        Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 24.dp).aspectRatio(1f)
          .swipes(left = app.playback::next, right = app.playback::previous, down = { nav.back() }),
        contentAlignment = Alignment.Center,
      ) {
        if (look.material != Material.Flat)
          Box(
            Modifier.fillMaxSize().graphicsLayer {
              scaleX = scale
              scaleY = scale
              rotationZ = -0.8f
            }.matter(matter.paper, look.page + 12.dp, seed = 50, depth = 1.6f, seam = true).padding(16.dp),
          ) { Artwork(t.cover?.replace("size=600", "size=900"), t.album.title, null, Modifier.fillMaxSize(), radius = look.page) }
        else
        Box(
          Modifier.fillMaxSize().graphicsLayer {
            scaleX = scale
            scaleY = scale
          }.shadow(32.dp, RoundedCornerShape(look.page), clip = false, ambientColor = Color.Black, spotColor = Color.Black),
        ) { Artwork(t.cover?.replace("size=600", "size=900"), t.album.title, null, Modifier.fillMaxSize(), radius = look.page) }
      }
      Row(Modifier.fillMaxWidth().padding(start = 28.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text(t.title, color = Color.White, style = MaterialTheme.typography.headlineSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { t.album.id?.let { nav.go(Route.Album(it)) } })
          Text(t.artist, color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Normal), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { t.artists.firstOrNull()?.id?.let { nav.go(Route.Artist(it)) } })
        }
        Box(Modifier.size(40.dp).then(if (look.material != Material.Flat) Modifier.matter(matter.paper, 20.dp, seed = 51) else Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.14f))), contentAlignment = Alignment.Center) { Heart(t, 22) }
        Spacer(Modifier.width(8.dp))
        Box(Modifier.size(40.dp).then(if (look.material != Material.Flat) Modifier.matter(matter.paper, 20.dp, seed = 52) else Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.14f))), contentAlignment = Alignment.Center) {
          MoreMenu(
            "More for ${t.title}",
            songMenu(app, t, nav, picker) +
              listOf(15, 30, 45, 60).map { m -> "Sleep timer: $m minutes" to { SleepTimer.set(app, m) } } +
              (if (SleepTimer.minutes != null) listOf("Turn off sleep timer" to { SleepTimer.set(app, null) }) else emptyList()),
          )
        }
      }
      SeekBar(p, still)
      Row(Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        IconBtn(EchoIcons.shuffle, if (p.shuffle) "Shuffle on" else "Shuffle off", if (p.shuffle) Color.White else Color.White.copy(alpha = 0.55f), 24) { app.playback.toggleShuffle() }
        IconBtn(EchoIcons.previous, "Previous", Color.White, 38) { app.playback.previous() }
        PlayButton(p.playing, enabled = true, onClick = app.playback::toggle, size = 84)
        IconBtn(EchoIcons.next, "Next", Color.White, 38) { app.playback.next() }
        IconBtn(if (p.repeat == Repeat.One) EchoIcons.repeatOne else EchoIcons.repeat, "Repeat", if (p.repeat != Repeat.Off) Color.White else Color.White.copy(alpha = 0.55f), 24) { app.playback.cycleRepeat() }
      }
      Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally)) {
        Pill(EchoIcons.lyrics, "Lyrics") { nav.go(Route.Listen) }
        Pill(EchoIcons.queue, "Up next", onQueue)
        if (SleepTimer.minutes != null) Pill(EchoIcons.moon, "${SleepTimer.minutes} min") { SleepTimer.set(app, null) }
      }
      LyricsCard(p) { nav.go(Route.Listen) }
      Spacer(Modifier.height(32.dp))
    }
  }
}

/** A translucent pill over the album's colours. */
@Composable
private fun Pill(icon: ImageVector, label: String, onClick: () -> Unit) {
  Row(
    Modifier.height(if (look.material != Material.Flat) 44.dp else 40.dp).bouncy(scale = 0.92f, label = label, onClick = onClick)
      .then(if (look.material != Material.Flat) Modifier.matter(matter.paper, 22.dp, seed = label.length) else Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.14f))).padding(horizontal = 16.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(icon, null, tint = Color.White, modifier = Modifier.size(18.dp))
    Spacer(Modifier.width(8.dp))
    Text(label, color = Color.White, style = MaterialTheme.typography.labelLarge)
  }
}

/** Now Playing's ground: soft blobs of the album's colours drifting over its darkest tone. */
@Composable
fun AlbumMesh(still: Boolean) {
  val pal = stagePalette()
  val accent by animateColorAsState(headerTone(pal.accentColor), tween(1200), label = "a")
  val second by animateColorAsState(headerTone(Color(pal.highlight.toArgb())).copy(alpha = 1f), tween(1200), label = "b")
  val base by animateColorAsState(Color(pal.room.toArgb()).compositeOver(Color.Black).let { lerp(it, Color.Black, 0.45f) }, tween(1200), label = "c")
  val drift = rememberInfiniteTransition(label = "drift")
  val k by drift.animateFloat(0f, 1f, infiniteRepeatable(tween(18000, easing = LinearEasing), RepeatMode.Reverse), label = "k")
  val m = if (still) 0.5f else k
  Box(
    Modifier.fillMaxSize().background(base).drawBehind {
      val w = size.width
      val h = size.height
      drawCircle(Brush.radialGradient(listOf(accent, Color.Transparent), Offset(w * (0.15f + 0.3f * m), h * 0.15f), w * 1.1f), w * 1.1f, Offset(w * (0.15f + 0.3f * m), h * 0.15f))
      drawCircle(Brush.radialGradient(listOf(second.copy(alpha = 0.8f), Color.Transparent), Offset(w * (0.95f - 0.3f * m), h * 0.55f), w), w, Offset(w * (0.95f - 0.3f * m), h * 0.55f))
      drawCircle(Brush.radialGradient(listOf(accent.copy(alpha = 0.7f), Color.Transparent), Offset(w * 0.2f, h * (0.95f - 0.1f * m)), w * 0.9f), w * 0.9f, Offset(w * 0.2f, h * (0.95f - 0.1f * m)))
      // A scrim so white text keeps its contrast on bright albums.
      drawRect(Color.Black.copy(alpha = 0.22f))
    },
  )
}

/**
 * The seek bar: a wavy line up to the playhead while playing (Android's expressive progress), flat
 * while paused, the rest a thin track; tap or drag to seek. The times under it, the remaining one
 * counting down.
 */
@Composable
private fun SeekBar(p: PlayerState, still: Boolean) {
  val app = LocalContext.current.echo
  var now by remember { mutableLongStateOf(p.positionNow()) }
  LaunchedEffect(p) {
    while (true) {
      now = p.positionNow()
      delay(100)
    }
  }
  var dragging by remember { mutableStateOf(false) }
  var dragValue by remember { mutableFloatStateOf(0f) }
  val d = p.durationMs.coerceAtLeast(1)
  val value = if (dragging) dragValue else (now.toFloat() / d).coerceIn(0f, 1f)
  val amp by animateFloatAsState(if (p.playing && !dragging && !still) 1f else 0f, tween(400), label = "amp")
  val phase = rememberInfiniteTransition(label = "wave")
  val shift by phase.animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "shift")
  val thick by animateFloatAsState(if (dragging) 8f else 5f, tween(150), label = "thick")
  val haptics = rememberHaptics()
  Column(Modifier.padding(horizontal = 28.dp, vertical = 14.dp)) {
    Box(
      Modifier.fillMaxWidth().height(28.dp)
        .semantics { contentDescription = "Seek" }
        .pointerInput(d) { detectTapGestures { o -> app.playback.seek(((o.x / size.width).coerceIn(0f, 1f) * d).toLong()) } }
        .pointerInput(d) {
          detectHorizontalDragGestures(
            onDragStart = { o ->
              haptics.tick()
              dragging = true
              dragValue = (o.x / size.width).coerceIn(0f, 1f)
            },
            onDragEnd = {
              haptics.tick()
              app.playback.seek((dragValue * d).toLong())
              dragging = false
            },
            onDragCancel = { dragging = false },
          ) { change, _ -> dragValue = (change.position.x / size.width).coerceIn(0f, 1f) }
        }
        .drawBehind {
          val y = size.height / 2
          val stroke = thick.dp.toPx()
          val x = size.width * value
          val gap = 6.dp.toPx()
          // The rest: a thin track after a small gap.
          if (x + gap < size.width) drawLine(Color.White.copy(alpha = 0.3f), Offset(x + gap, y), Offset(size.width, y), stroke * 0.8f, StrokeCap.Round)
          // The played part: a sine wave, its amplitude easing in on play.
          val wl = 28.dp.toPx()
          val a = 3.5.dp.toPx() * amp
          val path = Path()
          var px = 0f
          path.moveTo(0f, y + a * sin((0f / wl + (if (still) 0f else shift)) * 2 * PI).toFloat())
          while (px < x) {
            px = (px + 2f).coerceAtMost(x)
            path.lineTo(px, y + a * sin((px / wl - shift) * 2 * PI).toFloat())
          }
          if (x > 0f) drawPath(path, Color.White, style = Stroke(stroke, cap = StrokeCap.Round))
          // The playhead: a short upright bar.
          drawLine(Color.White, Offset(x, y - 9.dp.toPx()), Offset(x, y + 9.dp.toPx()), 4.dp.toPx(), StrokeCap.Round)
        },
    )
    Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
      Text(duration((value * d).toLong()), color = Color.White.copy(alpha = 0.65f), style = MaterialTheme.typography.labelMedium)
      Spacer(Modifier.weight(1f))
      Text("-" + duration(((1 - value) * d).toLong()), color = Color.White.copy(alpha = 0.65f), style = MaterialTheme.typography.labelMedium)
    }
  }
}

/** The lyrics card: the line being sung and the next ones, on frosted white; it opens the lyrics view. */
@Composable
private fun LyricsCard(p: PlayerState, onOpen: () -> Unit) {
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
    Modifier.padding(horizontal = 20.dp).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Color.White.copy(alpha = 0.12f)).clickable(onClick = onOpen).padding(20.dp),
  ) {
    Text("LYRICS", color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.labelMedium)
    Spacer(Modifier.height(12.dp))
    for ((i, l) in lines.drop(at).take(4).withIndex()) {
      Text(l.text, style = MaterialTheme.typography.headlineSmall, color = if (i == 0) Color.White else Color.White.copy(alpha = 0.4f), modifier = Modifier.padding(vertical = 3.dp))
    }
  }
}
