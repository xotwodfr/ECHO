package com.folk3s.echo.stage

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
import androidx.compose.foundation.layout.widthIn
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

/** Chrome and glass shared between the Stage and the dock over it (the Shell draws the dock). */
class StageChrome {
  var visible by mutableStateOf(true)
  val glass: SnapshotStateMap<String, GlassBox> = mutableStateMapOf()
}

val LocalStageChrome = staticCompositionLocalOf<StageChrome?> { null }

/** Marks a control as Stage glass: its box (root dp) goes to the GL glass pass (§7.11). */
fun Modifier.stageGlass(chrome: StageChrome?, key: String, radius: (w: Float, h: Float) -> Float, density: Float): Modifier =
  if (chrome == null) this
  else
    onGloballyPositioned { c ->
      val b = c.boundsInRoot()
      val w = b.width / density
      val h = b.height / density
      val r = radius(w, h)
      chrome.glass[key] = GlassBox(b.left / density, b.top / density, w, h, floatArrayOf(r, r, r, r))
    }

private const val LAST_TIER = "echo.visuals.lastTier"
private const val IDLE_MS = 3000L

/** S1 Listen, the Stage (PRODUCT_SPEC.md §6.1): the room, the view (lyrics, cover or visual), the chrome. */
@Composable
fun StageScreen(
  chrome: StageChrome,
  onClose: () -> Unit,
  dock: @Composable () -> Unit,
  lyrics: @Composable (StageView?) -> Unit = {},
) {
  val ctx = LocalContext.current
  val app = ctx.echo
  val p by app.playback.state.collectAsStateWithLifecycle()
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  val palette = stagePalette()
  var view by remember { mutableStateOf(StageViewMode.Lyrics) }
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
  LaunchedEffect(s, chrome.glass.toMap(), view) { s?.setGlass(chrome.glass.values.toList()) }

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
  DisposableEffect(Unit) { onDispose { chrome.glass.clear() } }

  Box(
    Modifier.fillMaxSize().background(Color(palette.room.toArgb())).pointerInput(Unit) {
      awaitPointerEventScope {
        while (true) {
          awaitPointerEvent(PointerEventPass.Initial)
          touchedAt = System.currentTimeMillis()
        }
      }
    },
  ) {
    AndroidView(
      factory = { c ->
        StageView(c, startTier, manual).also { v ->
          v.onTier = { t -> if (!manual) sp.edit().putString(LAST_TIER, t.name).apply() }
          stage = v
        }
      },
      modifier = Modifier.fillMaxSize(),
    )
    val t = p.track
    when {
      t == null ->
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
          Text("Nothing playing. Pick an album to start.", color = Chamber.muted)
          OutlinedButton(onClick = onClose, modifier = Modifier.padding(top = 12.dp)) { Text("Open the Library", color = Chamber.text) }
        }
      view == StageViewMode.Cover ->
        BoxWithConstraints(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
          val side = minOf(maxWidth, maxHeight * 0.6f, 640.dp)
          Artwork(t.cover, t.album.title, side, radius = 8.dp)
        }
      view == StageViewMode.Lyrics -> lyrics(s)
      else -> {}
    }
    TopChrome(chrome, view, { view = it }, onClose, dp)
    Box(Modifier.align(Alignment.BottomCenter)) { dock() }
    // Hidden chrome takes no input: a blind tap brings it back and never hits a control (§6.1).
    if (!chrome.visible) Box(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { touchedAt = System.currentTimeMillis() } })
  }
}

@Composable
private fun TopChrome(chrome: StageChrome, view: StageViewMode, setView: (StageViewMode) -> Unit, onClose: () -> Unit, density: Float) {
  val alpha by animateFloatAsState(if (chrome.visible) 1f else 0f, tween(if (chrome.visible) 160 else 640), label = "chrome")
  val activity = LocalContext.current as? Activity
  val root = LocalView.current
  var full by remember { mutableStateOf(false) }
  Row(
    Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.statusBars).padding(horizontal = 16.dp, vertical = 12.dp).alpha(alpha),
    horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    val circle = { w: Float, _: Float -> w / 2 }
    for ((v, icon) in listOf(StageViewMode.Lyrics to EchoIcons.lyrics, StageViewMode.Visual to EchoIcons.visual)) {
      StageButton(icon, v.label, view == v, chrome.visible, Modifier.stageGlass(chrome, "view-$v", circle, density)) { setView(if (view == v) StageViewMode.Cover else v) }
    }
    StageButton(EchoIcons.fullscreen, "Full screen", full, chrome.visible, Modifier.stageGlass(chrome, "full", circle, density)) {
      val w = activity?.window ?: return@StageButton
      val c = WindowCompat.getInsetsController(w, root)
      full = !full
      if (full) {
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        c.hide(WindowInsetsCompat.Type.systemBars())
      } else c.show(WindowInsetsCompat.Type.systemBars())
    }
    Brightness(chrome, density)
    StageButton(EchoIcons.close, "Library", false, chrome.visible, Modifier.stageGlass(chrome, "close", circle, density), onClose)
  }
}

/** A round Stage control (§9.1): 48 dp, a hairline ring, the room's tint; glass is drawn under it. */
@Composable
private fun StageButton(icon: ImageVector, label: String, pressed: Boolean, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
  val palette = stagePalette()
  Box(
    modifier
      .size(48.dp)
      .clip(CircleShape)
      .background(if (pressed) Chamber.text.copy(alpha = 0.18f) else Color(palette.room.toArgb()).copy(alpha = 0.3f))
      .border(1.dp, Chamber.text.copy(alpha = if (pressed) 0.6f else 0.28f), CircleShape)
      .clickable(enabled = enabled, onClick = onClick)
      .semantics {
        contentDescription = label
        selected = pressed
      },
    contentAlignment = Alignment.Center,
  ) { Icon(icon, null, tint = Chamber.text, modifier = Modifier.size(20.dp)) }
}

/**
 * The backdrop's brightness (per device), like Control Center's slider lying on its side: the
 * round button widens into a pill that is the slider, white filling it from the left.
 */
@Composable
private fun Brightness(chrome: StageChrome, density: Float) {
  val app = LocalContext.current.echo
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  val palette = stagePalette()
  var open by remember { mutableStateOf(false) }
  val track: Dp = 154.dp
  val width by animateDpAsState(if (open) 48.dp + track else 48.dp, tween(240), label = "bright")
  Box(
    Modifier.height(48.dp).width(width).clip(CircleShape)
      .background(if (open) Chamber.text.copy(alpha = 0.18f) else Color(palette.room.toArgb()).copy(alpha = 0.3f))
      .border(1.dp, Chamber.text.copy(alpha = if (open) 0f else 0.28f), CircleShape)
      .stageGlass(chrome, "brightness", { _, h -> h / 2 }, density)
      .semantics { contentDescription = "Background brightness" },
  ) {
    Row(Modifier.fillMaxHeight()) {
      Box(
        Modifier.size(48.dp).background(if (open) Chamber.text else Color.Transparent).clickable { open = !open },
        contentAlignment = Alignment.Center,
      ) { Icon(EchoIcons.brightness, null, tint = if (open) Chamber.ground else Chamber.text, modifier = Modifier.size(20.dp)) }
      if (open) {
        Box(
          Modifier.fillMaxHeight().widthIn(max = track).fillMaxWidth()
            .pointerInput(Unit) {
              detectTapGestures { o -> app.prefs.update { it.copy(backdrop = (o.x / size.width).coerceIn(0f, 1f)) } }
            }
            .pointerInput(Unit) {
              detectHorizontalDragGestures { change, _ -> app.prefs.update { it.copy(backdrop = (change.position.x / size.width).coerceIn(0f, 1f)) } }
            }
            .drawBehind { drawRect(Chamber.text, size = Size(size.width * prefs.backdrop, size.height)) },
        )
      }
    }
  }
}
