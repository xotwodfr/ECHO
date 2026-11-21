package com.folk3s.echo.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.api.LinkPeek
import com.folk3s.echo.api.approveLink
import com.folk3s.echo.api.linkCodeOf
import com.folk3s.echo.api.peekLink
import com.folk3s.echo.echo
import kotlinx.coroutines.launch

/**
 * Settings → Sign in on a computer (src/server/qrlogin.ts): scan the QR code on ECHO's web sign-in
 * page, see which browser is asking and from where, and approve: that browser is signed in as you.
 */
@Composable
fun LinkScanScreen(onClose: () -> Unit) {
  val app = LocalContext.current.echo
  val ctx = LocalContext.current
  val scope = rememberCoroutineScope()
  var allowed by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
  val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it }
  LaunchedEffect(Unit) { if (!allowed) ask.launch(Manifest.permission.CAMERA) }
  var found by remember { mutableStateOf<Pair<String, LinkPeek>?>(null) }
  var note by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }
  var done by remember { mutableStateOf<String?>(null) }

  fun onScan(text: String) {
    if (found != null || busy || done != null) return
    val id = linkCodeOf(text, app.api.base)
    if (id == null) {
      note = "That isn't a sign-in code from ${app.api.base.substringAfter("://")}."
      return
    }
    busy = true
    scope.launch {
      try {
        found = id to app.api.peekLink(id)
        note = null
      } catch (e: ApiError) {
        note = if (e.status == 404) "That code ran out. Reload the sign-in page and scan the new one." else "Couldn't check the code. Try again."
      } catch (_: java.io.IOException) {
        note = "ECHO didn't answer. Check the connection and try again."
      } finally {
        busy = false
      }
    }
  }

  Box(Modifier.fillMaxSize().background(Color.Black)) {
    if (allowed && done == null) Camera(paused = found != null, onScan = ::onScan)
    if (allowed && done == null) Viewfinder(Modifier.align(Alignment.Center).size(240.dp))
    Column(Modifier.fillMaxWidth().statusBarsPadding().padding(top = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("Sign in on a computer", color = Color.White, fontWeight = FontWeight(800), fontSize = 18.sp, fontFamily = Figtree)
      Text("Scan the QR code on ECHO's sign-in page.", color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp, fontFamily = Figtree, modifier = Modifier.padding(top = 4.dp))
    }
    Box(Modifier.statusBarsPadding().padding(6.dp)) { IconBtn(EchoIcons.chevronLeft, "Back", Color.White, 26, onClose) }
    Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(16.dp)) {
      note?.let {
        Text(it, color = Color.White, fontSize = 14.sp, fontFamily = Figtree, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xCC28242E)).padding(14.dp).semantics { liveRegion = LiveRegionMode.Polite })
        Spacer(Modifier.height(10.dp))
      }
      val f = found
      if (done != null)
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(Color(0xE628242E)).padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
          Text("✓ $done is signed in", color = Color.White, fontWeight = FontWeight(800), fontSize = 17.sp, fontFamily = Figtree)
          SignButton("Done", primary = true, onClick = onClose)
        }
      else if (f != null)
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(Color(0xE628242E)).padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Text("Sign in ${f.second.browser}?", color = Color.White, fontWeight = FontWeight(800), fontSize = 17.sp, fontFamily = Figtree)
          Text(
            "From network ${f.second.ip}. It will be signed in as you. Only approve a sign-in you started yourself.",
            color = Color.White.copy(alpha = 0.72f),
            fontSize = 13.sp,
            fontFamily = Figtree,
          )
          Spacer(Modifier.height(8.dp))
          SignButton(if (busy) "Signing in…" else "Approve", primary = true, enabled = !busy) {
            busy = true
            scope.launch {
              try {
                app.api.approveLink(f.first)
                done = f.second.browser
              } catch (e: Exception) {
                note = if (e is ApiError && e.status == 404) "That code ran out. Reload the sign-in page and scan the new one." else "Couldn't approve. Try again."
                found = null
              } finally {
                busy = false
              }
            }
          }
          SignButton("Cancel", primary = false) { found = null }
        }
    }
  }
}
