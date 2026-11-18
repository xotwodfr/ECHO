package com.folk3s.echo.stage

import com.folk3s.echo.LyricStyle
import com.folk3s.echo.ui.AlbumMesh
import com.folk3s.echo.ui.Material
import com.folk3s.echo.ui.matterGround
import com.folk3s.echo.ui.hoop
import com.folk3s.echo.ui.Sheet
import com.folk3s.echo.ui.headerTone
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import android.app.Activity
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.Quality
import com.folk3s.echo.VisualMode
import com.folk3s.echo.api.toArgb
import com.folk3s.echo.echo
import com.folk3s.echo.ui.Artwork
import com.folk3s.echo.ui.Chamber
import com.folk3s.echo.ui.EchoIcons
import kotlinx.coroutines.delay

enum class StageViewMode(val label: String) { Lyrics("Lyrics"), Cover("Cover"), Visual("Visual") }

/** Chrome shared between the Stage and the dock over it (the Shell draws the dock). */
class StageChrome {
  var visible by mutableStateOf(true)
}

val LocalStageChrome = staticCompositionLocalOf<StageChrome?> { null }

private const val LAST_TIER = "echo.visuals.lastTier"
private const val IDLE_MS = 3000L

/** S1 Listen, the Stage (PRODUCT_SPEC.md §6.1): the room, the view (lyrics, cover or visual), the chrome. */
@Composable
fun StageScreen(
  chrome: StageChrome,
  onClose: () -> Unit,
  dock: @Composable () -> Unit,
) {
  val ctx = LocalContext.current
  val app = ctx.echo
  val p by app.playback.state.collectAsStateWithLifecycle()
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  val palette = stagePalette()
  var view by remember { mutableStateOf(StageViewMode.Lyrics) }
  var picking by remember { mutableStateOf(false) }
  val style = prefs.lyricStyle
  // The visualizer room: ECHO classic always has it; the other styles when the switch is on.
  val room = style == LyricStyle.Classic || (prefs.lyricVisualizer && style != LyricStyle.ColourBlock)
  val dp = LocalDensity.current.density
  val sp = remember { ctx.getSharedPreferences("echo.stage", 0) }

  val manual = prefs.quality != Quality.Auto
  val startTier =
    when (prefs.quality) {
      Quality.High -> Tier.T0
      Quality.Balanced -> Tier.T1
      Quality.Low -> Tier.T2
      Quality.Minimal -> Tier.T3
      Quality.Auto -> sp.getString(LAST_TIER, null)?.let { runCatching { Tier.valueOf(it) }.getOrNull() }?.takeIf { it != Tier.T3 } ?: Tier.T1
    }
  var stage by remember { mutableStateOf<StageView?>(null) }
  var dockPx by remember { mutableStateOf(0f) }

  // Idle chrome hides after 3 s while playing (§6.1); any touch brings it back.
  var touchedAt by remember { mutableStateOf(System.currentTimeMillis()) }
  LaunchedEffect(touchedAt, p.playing) {
    chrome.visible = true
    if (!p.playing) return@LaunchedEffect
    delay(IDLE_MS)
    chrome.visible = false
  }

  val s = stage
  LaunchedEffect(s, p.playing) { s?.playing = p.playing }
  LaunchedEffect(s, chrome.visible) { s?.setChrome(chrome.visible) }
  LaunchedEffect(s, palette) { s?.setPalette(palette) }
  LaunchedEffect(s, prefs.backdrop) { s?.setBrightness(prefs.backdrop) }
  LaunchedEffect(s, prefs.intensity) { s?.setIntensity(prefs.intensity) }
  val reduced = app.prefs.reducedMotion(prefs)
  LaunchedEffect(s, prefs.mode, reduced) {
    s?.setMode(
      when {
        reduced || prefs.mode == VisualMode.Still -> RoomMode.Still
        prefs.mode == VisualMode.Ambient -> RoomMode.Ambient
        else -> RoomMode.Reverb // Auto: Navidrome is always heard (§3.5)
      },
    )
  }
  LaunchedEffect(s, p.track?.album?.key) {
    s?.showCover(p.track?.cover?.replace("size=600", "size=300"))
  }
  LaunchedEffect(s, p.track?.key) { s?.trackStartedAt = android.os.SystemClock.elapsedRealtime() }

  // The GL view pauses with the activity: no frames while hidden (PERF-04); audio is not its business.
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  DisposableEffect(lifecycle, s) {
    val obs = LifecycleEventObserver { _, e ->
      if (e == Lifecycle.Event.ON_PAUSE) s?.onPause()
      if (e == Lifecycle.Event.ON_RESUME) s?.onResume()
    }
    lifecycle.addObserver(obs)
    onDispose { lifecycle.removeObserver(obs) }
  }

  Box(
    Modifier.fillMaxSize().background(if (style == LyricStyle.ColourBlock) headerTone(palette.accentColor) else Color(palette.room.toArgb())).pointerInput(Unit) {
      awaitPointerEventScope {
        while (true) {
          awaitPointerEvent(PointerEventPass.Initial)
          touchedAt = System.currentTimeMillis()
        }
      }
    },
  ) {
    if (room)
      AndroidView(
        factory = { c ->
          StageView(c, startTier, manual).also { v ->
            v.onTier = { t -> if (!manual) sp.edit().putString(LAST_TIER, t.name).apply() }
            stage = v
          }
        },
        onRelease = { stage = null },
        modifier = Modifier.fillMaxSize(),
      )
    else if (style == LyricStyle.Clay) Box(Modifier.fillMaxSize().matterGround(com.folk3s.echo.stage.lyrics.slabOf(materialFor(style)), Material.Clay))
    else if (style == LyricStyle.Embroidered) Box(Modifier.fillMaxSize().matterGround(materialFor(style).accent(2).copy(alpha = 1f), Material.Yarn))
    else if (style != LyricStyle.ColourBlock) AlbumMesh(reduced)
    val t = p.track
    when {
      t == null ->
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
          Text("Nothing playing. Pick an album to start.", color = Chamber.muted)
          OutlinedButton(onClick = onClose, modifier = Modifier.padding(top = 12.dp)) { Text("Open the Library", color = Chamber.text) }
        }
      view != StageViewMode.Lyrics ->
        // The cover and the song alone, centred (the owner's reference: no lyrics, the cover).
        BoxWithConstraints(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
          val side = minOf(maxWidth, maxHeight * 0.55f, 640.dp)
          Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Artwork(t.cover, t.album.title, side, radius = 8.dp)
            Text(t.title, color = Chamber.text, style = androidx.compose.material3.MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 20.dp))
            Text(t.artist, color = Chamber.muted, style = androidx.compose.material3.MaterialTheme.typography.bodyLarge)
          }
        }
      else ->
        // The song as a header, the lyric column under it (the phone layout of the reference).
        // The lyric column right under the top row (the song sits in that row, between its buttons).
        Column(Modifier.fillMaxSize()) {
          Spacer(Modifier.windowInsetsPadding(WindowInsets.statusBars).height(64.dp))
          Box(Modifier.weight(1f).fillMaxWidth()) { LyricsView(s, dockPx, chrome, style) }
        }
    }
    TopChrome(chrome, onClose, dp, if (view == StageViewMode.Lyrics && style != LyricStyle.Cinema && style != LyricStyle.Kinetic) t else null) { picking = true }
    Box(Modifier.align(Alignment.BottomCenter).onGloballyPositioned { dockPx = it.size.height.toFloat() }) { dock() }
    // Hidden chrome takes no input: a blind tap brings it back and never hits a control (§6.1).
    if (!chrome.visible) Box(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { touchedAt = System.currentTimeMillis() } })
    if (picking) StylePicker { picking = false }
  }
}

/** The lyric style and the visualizer switch, from the lyrics view itself. */
@Composable
private fun StylePicker(onClose: () -> Unit) {
  val app = LocalContext.current.echo
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  Sheet(onClose, fit = true) {
    Column(Modifier.padding(bottom = 24.dp)) {
      Text("Lyrics style", style = androidx.compose.material3.MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
      for (st in LyricStyle.entries) {
        val on = prefs.lyricStyle == st
        Row(
          Modifier.fillMaxWidth().clickable { app.prefs.update { it.copy(lyricStyle = st) } }.padding(horizontal = 24.dp, vertical = 10.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          RadioButton(selected = on, onClick = null)
          Column(Modifier.padding(start = 14.dp)) {
            Text(st.label, style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
            Text(st.blurb, color = Chamber.muted, style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
          }
        }
      }
      Row(
        Modifier.fillMaxWidth().clickable { app.prefs.update { it.copy(lyricVisualizer = !it.lyricVisualizer) } }.padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Column(Modifier.weight(1f)) {
          Text("Visualizer behind the lyrics", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
          Text(
            if (prefs.lyricStyle == LyricStyle.Classic) "ECHO classic always has it." else if (prefs.lyricStyle == LyricStyle.ColourBlock) "Colour block keeps its solid colour." else "Off: the album's colours drift slowly.",
            color = Chamber.muted,
            style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
          )
        }
        Switch(checked = prefs.lyricVisualizer, onCheckedChange = null)
      }
    }
  }
}

@Composable
private fun TopChrome(chrome: StageChrome, onClose: () -> Unit, density: Float, song: com.folk3s.echo.api.Track?, onStyle: () -> Unit) {
  val alpha by animateFloatAsState(if (chrome.visible) 1f else 0f, tween(if (chrome.visible) 160 else 640), label = "chrome")
  val app = LocalContext.current.echo
  val ctx by app.playback.context.collectAsStateWithLifecycle()
  // The buttons fade with the chrome; the song stays, so the lyrics never lose their title.
  Row(
    Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.statusBars).padding(horizontal = 12.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.alpha(alpha)) { StageButton(EchoIcons.chevronDown, "Close Now playing", false, chrome.visible, Modifier, onClose) }
    if (song != null)
      Row(Modifier.weight(1f).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Artwork(song.cover, song.album.title, 40.dp, radius = 8.dp)
        Column(Modifier.padding(start = 10.dp)) {
          Text(song.title, color = Chamber.text, style = androidx.compose.material3.MaterialTheme.typography.titleSmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
          Text(song.artist, color = Chamber.text.copy(alpha = 0.65f), style = androidx.compose.material3.MaterialTheme.typography.bodySmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
      }
    else
      Column(Modifier.weight(1f).alpha(alpha), horizontalAlignment = Alignment.CenterHorizontally) {
        ctx?.let {
          Text("PLAYING FROM", color = Chamber.text.copy(alpha = 0.7f), style = androidx.compose.material3.MaterialTheme.typography.labelSmall)
          Text(it.title, color = Chamber.text, style = androidx.compose.material3.MaterialTheme.typography.titleSmall, maxLines = 1)
        }
      }
    Box(Modifier.alpha(alpha)) { StageButton(EchoIcons.textStyle, "Lyrics style", false, chrome.visible, Modifier, onStyle) }
  }
}

/** A round Stage control (§9.1): an M3 tonal icon button, 48 dp; selected, the secondary container. */
@Composable
private fun StageButton(icon: ImageVector, label: String, pressed: Boolean, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
  val c = androidx.compose.material3.MaterialTheme.colorScheme
  Box(
    modifier
      .size(48.dp)
      .clip(CircleShape)
      .background(if (pressed) c.secondaryContainer else c.surfaceContainerHigh)
      .clickable(enabled = enabled, onClick = onClick)
      .semantics {
        contentDescription = label
        selected = pressed
      },
    contentAlignment = Alignment.Center,
  ) { Icon(icon, null, tint = if (pressed) c.onSecondaryContainer else c.onSurface, modifier = Modifier.size(20.dp)) }
}

/** The Lyrics view (§9.4): the field, or a note where the column would be; the credit above the dock. */
@Composable
private fun LyricsView(stage: StageView?, dockPx: Float, chrome: StageChrome, style: LyricStyle) {
  val app = LocalContext.current.echo
  val ls by app.lyrics.state.collectAsStateWithLifecycle()
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  val doc = ls.doc
  val alpha by animateFloatAsState(if (chrome.visible) 1f else 0f, tween(if (chrome.visible) 160 else 640), label = "credit")
  @Composable
  fun note(text: String) =
    BoxWithConstraints(Modifier.fillMaxSize()) {
      Text(text, color = Chamber.muted, modifier = Modifier.padding(start = maxWidth * 0.18f, top = maxHeight * 0.4f))
    }
  when {
    ls.status == com.folk3s.echo.stage.lyrics.LyricsStatus.Waiting -> note("Finding lyrics…")
    doc == null -> note("No lyrics found")
    doc.sync == "none" ->
      if (!prefs.showUnsynced) note("Lyrics aren’t time-synced for this track")
      else
        androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().padding(horizontal = 32.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 120.dp, bottom = 200.dp)) {
          item { Text("Lyrics aren’t time-synced for this track", color = Chamber.faint, modifier = Modifier.padding(bottom = 24.dp)) }
          items(doc.lines.size) { i -> Text(doc.lines[i].text, color = Chamber.text, style = androidx.compose.material3.MaterialTheme.typography.titleLarge.copy(fontFamily = com.folk3s.echo.ui.Figtree), modifier = Modifier.padding(vertical = 6.dp)) }
        }
    style == LyricStyle.Classic -> com.folk3s.echo.stage.lyrics.LyricsField(stage, dockPx)
    else -> {
      val reduced = app.prefs.reducedMotion(prefs)
      val offset = ls.offsetMs + prefs.lyricOffsetMs
      val mat = if (style == LyricStyle.Clay || style == LyricStyle.Embroidered) materialFor(style) else null
      val seek = { ms: Long ->
        app.playback.seek(ms + offset)
        if (!app.playback.state.value.playing) app.playback.toggle()
      }
      val accent = Color(0xFF4FD8FF).takeIf { style == LyricStyle.Karaoke } ?: Color(stagePalette().highlight.toArgb())
      if (style == LyricStyle.Embroidered)
        // The words on an embroidery hoop, set on the knitted ground.
        Box(Modifier.fillMaxSize().padding(start = 14.dp, end = 14.dp, top = 8.dp, bottom = with(LocalDensity.current) { dockPx.toDp() } + 10.dp).hoop().padding(vertical = 12.dp)) {
          com.folk3s.echo.stage.lyrics.StyledLyrics(doc, style, offset, prefs.lyricScale, reduced, accent, 0f, mat, seek)
        }
      else com.folk3s.echo.stage.lyrics.StyledLyrics(doc, style, offset, prefs.lyricScale, reduced, accent, dockPx, mat, seek)
    }
  }
  // The credit stays with the chrome (LYRICS_INTEGRATION.md §8: removing it is a defect).
  if (doc != null) {
    Box(Modifier.fillMaxSize().padding(start = 24.dp, bottom = with(LocalDensity.current) { dockPx.toDp() } + 8.dp).alpha(alpha), contentAlignment = Alignment.BottomStart) {
      Text(doc.attribution.text, color = Chamber.faint, style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
    }
  }
}

/** The palette a material lyric style draws with: Clay's for the dark (as the user set it), or Yarn's. */
@Composable
private fun materialFor(style: LyricStyle): com.folk3s.echo.ui.MatterColors {
  val prefs = LocalContext.current.echo.prefs.state.value
  return com.folk3s.echo.ui.matterColors(if (style == LyricStyle.Clay) com.folk3s.echo.ui.ThemePreset.Clay else com.folk3s.echo.ui.ThemePreset.Yarn, true, prefs.clayDark, stagePalette().accentColor)
}
