package com.folk3s.echo.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.api.GuestPeek
import com.folk3s.echo.api.durationText
import com.folk3s.echo.api.guestCodeOf
import com.folk3s.echo.api.peekGuestCode
import com.folk3s.echo.api.redeemGuestCode
import com.folk3s.echo.echo
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory
import kotlinx.coroutines.launch

/**
 * Scan a guest code (guests.ts): the camera finds the QR code on its own; before joining, the
 * guest sees whose pass it is and for how long. Joining keeps this phone signed in as the guest.
 */
@Composable
fun GuestScanScreen(onBack: () -> Unit) {
  val app = LocalContext.current.echo
  val ctx = LocalContext.current
  val scope = rememberCoroutineScope()
  var allowed by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
  var asked by remember { mutableStateOf(false) }
  val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
    allowed = it
    asked = true
  }
  LaunchedEffect(Unit) { if (!allowed) ask.launch(Manifest.permission.CAMERA) }
  var found by remember { mutableStateOf<Pair<String, GuestPeek>?>(null) }
  var note by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }
  var checking by remember { mutableStateOf(false) }

  fun onScan(text: String) {
    if (found != null || checking) return
    val code = guestCodeOf(text, app.api.base)
    if (code == null) {
      note = "That isn't a guest code for ${app.api.base.substringAfter("://")}."
      return
    }
    checking = true
    scope.launch {
      try {
        found = code to app.api.peekGuestCode(code)
        note = null
      } catch (e: ApiError) {
        note = if (e.status == 404) "This code was used or has expired. Ask for a new one." else "Couldn't check the code. Try again."
      } catch (e: java.io.IOException) {
        note = "ECHO didn't answer. Check the connection and try again."
      } finally {
        checking = false
      }
    }
  }

  Box(Modifier.fillMaxSize().background(Color.Black)) {
    if (allowed) Camera(paused = found != null, onScan = ::onScan)
    else
      Column(Modifier.align(Alignment.Center).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("ECHO needs the camera to scan a guest code.", color = Color.White, fontSize = 16.sp, fontFamily = Figtree)
        if (asked) SignButton("Allow the camera", primary = true) { ask.launch(Manifest.permission.CAMERA) }
      }
    if (allowed) Viewfinder(Modifier.align(Alignment.Center).size(240.dp))
    Column(Modifier.fillMaxWidth().statusBarsPadding().padding(top = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("Scan a guest code", color = Color.White, fontWeight = FontWeight(800), fontSize = 18.sp, fontFamily = Figtree)
      Text("Point the camera at the QR code someone shows you.", color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp, fontFamily = Figtree, modifier = Modifier.padding(top = 4.dp))
    }
    Box(Modifier.statusBarsPadding().padding(6.dp)) { IconBtn(EchoIcons.chevronLeft, "Back", Color.White, 26, onBack) }
    Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(16.dp)) {
      note?.let {
        Text(it, color = Color.White, fontSize = 14.sp, fontFamily = Figtree, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xCC28242E)).padding(14.dp).semantics { liveRegion = LiveRegionMode.Polite })
        Spacer(Modifier.height(10.dp))
      }
      AnimatedVisibility(found != null, enter = slideInVertically { it }) {
        val (code, peek) = found ?: return@AnimatedVisibility
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(Color(0xE628242E)).padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Text("Guest pass from ${peek.invitedBy}", color = Color.White, fontWeight = FontWeight(800), fontSize = 17.sp, fontFamily = Figtree)
          Text(
            "${durationText(peek.durationMs).replaceFirstChar { it.uppercase() }} of listening on ${app.api.base.substringAfter("://")}. This phone stays signed in until it runs out.",
            color = Color.White.copy(alpha = 0.72f),
            fontSize = 13.sp,
            fontFamily = Figtree,
          )
          Spacer(Modifier.height(8.dp))
          SignButton(if (busy) "Joining…" else "Start listening", primary = true, enabled = !busy) {
            busy = true
            scope.launch {
              try {
                app.api.redeemGuestCode(code) // the token's arrival opens the app
              } catch (e: Exception) {
                note = if (e is ApiError && e.status == 404) "This code was used or has expired. Ask for a new one." else "Couldn't join. Try again."
                found = null
              } finally {
                busy = false
              }
            }
          }
          SignButton("Scan another", primary = false) { found = null }
        }
      }
    }
  }
}

/** The camera, decoding QR codes continuously, following the screen's lifecycle. */
@Composable
internal fun Camera(paused: Boolean, onScan: (String) -> Unit) {
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  val ctx = LocalContext.current
  val view = remember {
    BarcodeView(ctx).apply {
      decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
    }
  }
  DisposableEffect(lifecycle, view) {
    val obs = LifecycleEventObserver { _, e ->
      when (e) {
        Lifecycle.Event.ON_RESUME -> view.resume()
        Lifecycle.Event.ON_PAUSE -> view.pause()
        else -> {}
      }
    }
    lifecycle.addObserver(obs)
    if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view.resume()
    onDispose {
      lifecycle.removeObserver(obs)
      view.pause()
    }
  }
  DisposableEffect(paused) {
    if (!paused) view.decodeContinuous { r -> r.text?.let(onScan) } else view.stopDecoding()
    onDispose {}
  }
  AndroidView({ view }, Modifier.fillMaxSize())
}

/** Four amber corners and a scan line sweeping between them. */
@Composable
internal fun Viewfinder(modifier: Modifier) {
  val sweep = rememberInfiniteTransition(label = "scan")
  val y by sweep.animateFloat(0.08f, 0.92f, infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Reverse), label = "y")
  Canvas(modifier) {
    val w = size.width
    val c = w * 0.18f
    val stroke = Stroke(width = 5.dp.toPx(), cap = StrokeCap.Round)
    val r = 18.dp.toPx()
    for ((ox, oy) in listOf(0f to 0f, 1f to 0f, 0f to 1f, 1f to 1f)) {
      val x = ox * w
      val yy = oy * size.height
      val dx = if (ox == 0f) 1f else -1f
      val dy = if (oy == 0f) 1f else -1f
      drawLine(SIGN_AMBER, Offset(x + dx * r * 0.2f, yy), Offset(x + dx * c, yy), stroke.width, StrokeCap.Round)
      drawLine(SIGN_AMBER, Offset(x, yy + dy * r * 0.2f), Offset(x, yy + dy * c), stroke.width, StrokeCap.Round)
    }
    val ly = size.height * y
    drawRoundRect(
      Brush.horizontalGradient(listOf(Color.Transparent, SIGN_AMBER, Color.Transparent)),
      topLeft = Offset(w * 0.06f, ly),
      size = Size(w * 0.88f, 3.dp.toPx()),
      cornerRadius = CornerRadius(2.dp.toPx()),
    )
  }
}
