package com.folk3s.echo.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.echo
import com.folk3s.echo.together.Offer
import com.folk3s.echo.together.TogetherItem
import com.folk3s.echo.together.TogetherState
import com.folk3s.echo.together.togetherIdOf

// Listen together's screens (docs/TOGETHER.md; together/Together.kt): the sheet with the session's
// QR code, listeners and shared queue (or Start and Scan to join), the scanner, and the offer a
// scanned code or an opened link makes.

/** "Listening together · 3" while in a session, "Together" otherwise (Now Playing's pill label). */
fun togetherLabel(s: TogetherState?) = if (s == null) "Together" else "Together · ${s.members.size}"

/** The sheet, the scanner and the offer, over everything (Shell). */
@Composable
fun TogetherHost() {
  val t = LocalContext.current.echo.together
  val open by t.sheetOpen.collectAsStateWithLifecycle()
  val scanning by t.scanning.collectAsStateWithLifecycle()
  val offer by t.offer.collectAsStateWithLifecycle()
  if (open) TogetherSheet(onClose = { t.sheetOpen.value = false })
  if (scanning) TogetherScan(onBack = { t.scanning.value = false })
  offer?.let { OfferSheet(it) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TogetherSheet(onClose: () -> Unit) {
  val app = LocalContext.current.echo
  val t = app.together
  val s by t.session.collectAsStateWithLifecycle()
  var error by remember { mutableStateOf<String?>(null) }
  ModalBottomSheet(onDismissRequest = onClose) {
    Column(
      Modifier.fillMaxWidth().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp, vertical = 4.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Text(if (s == null) "Listen together" else "Listening together · ${s!!.members.size}", style = MaterialTheme.typography.titleLarge, modifier = Modifier.fillMaxWidth())
      val session = s
      if (session == null) {
        Text(
          "Everyone hears the same song at the same moment, and everyone can add songs. Start a session and show its code, or scan someone's code to join.",
          color = Chamber.muted,
          style = MaterialTheme.typography.bodyMedium,
          modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 16.dp),
        )
        SignButton("Start a session", primary = true) { t.start { error = it } }
        Spacer(Modifier.height(10.dp))
        SignButton("Scan a code to join", primary = false, icon = EchoIcons.qr) {
          t.sheetOpen.value = false
          t.scanning.value = true
        }
        error?.let { Text(it, color = Color(0xFFE0707A), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 10.dp)) }
        Spacer(Modifier.height(24.dp))
        return@Column
      }
      Text(
        "Scan this with the ECHO app, or open the link signed in to this ECHO.",
        color = Chamber.muted,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 14.dp),
      )
      val link = app.api.url(session.url)
      Box(Modifier.size(212.dp).clip(RoundedCornerShape(26.dp)).background(Color.White).padding(16.dp), contentAlignment = Alignment.Center) {
        val bmp = remember(link) { qrBitmap(link) }
        Image(bmp, "Listen together QR code", Modifier.fillMaxWidth(), filterQuality = FilterQuality.None)
      }
      Text(link, color = Chamber.muted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
      Section("Listeners")
      for (m in session.members) {
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
          Box(Modifier.size(34.dp).clip(CircleShape).background(SIGN_AMBER.copy(alpha = if (m.online) 1f else 0.4f)), contentAlignment = Alignment.Center) {
            Text(m.username.take(1).uppercase(), color = Color(0xFF2A1020), fontWeight = FontWeight(800))
          }
          Spacer(Modifier.size(12.dp))
          val tags = listOfNotNull("host".takeIf { m.host }, "you".takeIf { m.id == session.you.id }, "away".takeIf { !m.online })
          Text(m.username + tags.joinToString("") { " · $it" }, style = MaterialTheme.typography.bodyLarge)
        }
      }
      Section("Now playing")
      val now = session.now
      if (now == null) Muted("Nothing playing yet: add a song from any song's menu.") else QueueRow(now, session, isNow = true)
      Section("Up next")
      if (session.queue.isEmpty()) Muted("Nothing queued. Add songs from any song's menu.")
      for (it in session.queue) QueueRow(it, session, isNow = false)
      Spacer(Modifier.height(18.dp))
      SignButton(if (session.you.host) "End session" else "Leave", primary = false) { t.leave() }
      Spacer(Modifier.height(24.dp))
    }
  }
}

@Composable
private fun Section(title: String) =
  Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 6.dp))

@Composable
private fun Muted(text: String) = Text(text, color = Chamber.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth())

@Composable
private fun QueueRow(it: TogetherItem, s: TogetherState, isNow: Boolean) {
  val t = LocalContext.current.echo.together
  val mine = it.addedBy.id == s.you.id
  Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
    Artwork(it.track.cover, it.track.album, null, Modifier.size(44.dp), radius = 6.dp)
    Column(Modifier.weight(1f).padding(horizontal = 12.dp).then(if (s.you.host && !isNow) Modifier.clickable { t.jump(it.uid) } else Modifier)) {
      Text(it.track.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (isNow) FontWeight(700) else null)
      Text("${it.track.artist} · added by ${if (mine) "you" else it.addedBy.username}", color = Chamber.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (!isNow && (s.you.host || mine)) TextButton(onClick = { t.remove(it.uid) }) { Text("Remove") }
  }
}

/** Scan a Listen together code: the guest scanner's camera, for `<origin>/together/<id>`. */
@Composable
private fun TogetherScan(onBack: () -> Unit) {
  val app = LocalContext.current.echo
  val ctx = LocalContext.current
  BackHandler(onBack = onBack)
  var allowed by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
  val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it }
  LaunchedEffect(Unit) { if (!allowed) ask.launch(Manifest.permission.CAMERA) }
  var note by remember { mutableStateOf<String?>(null) }
  Box(Modifier.fillMaxSize().background(Color.Black)) {
    if (allowed)
      Camera(paused = false) { text ->
        val id = togetherIdOf(text, app.api.base)
        if (id == null) note = "That isn't a Listen together code for ${app.api.base.substringAfter("://")}."
        else {
          onBack()
          app.together.offer(id)
        }
      }
    else Text("ECHO needs the camera to scan a code.", color = Color.White, fontSize = 16.sp, modifier = Modifier.align(Alignment.Center).padding(32.dp))
    if (allowed) Viewfinder(Modifier.align(Alignment.Center).size(240.dp))
    Column(Modifier.fillMaxWidth().statusBarsPadding().padding(top = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("Listen together", color = Color.White, fontWeight = FontWeight(800), fontSize = 18.sp)
      Text("Point the camera at the session's QR code.", color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
    }
    Box(Modifier.statusBarsPadding().padding(6.dp)) { IconBtn(EchoIcons.chevronLeft, "Back", Color.White, 26, onBack) }
    note?.let {
      Text(
        it,
        color = Color.White,
        fontSize = 14.sp,
        modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xCC28242E)).padding(14.dp).semantics { liveRegion = LiveRegionMode.Polite },
      )
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OfferSheet(o: Offer) {
  val t = LocalContext.current.echo.together
  ModalBottomSheet(onDismissRequest = t::dismissOffer) {
    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 22.dp, vertical = 4.dp)) {
      Text("Listen together", style = MaterialTheme.typography.titleLarge)
      Text(
        when (o) {
          is Offer.Loading -> "Checking the code…"
          is Offer.Ready -> "${o.host} invited you to listen together${if (o.members > 1) " with ${o.members - 1} other${if (o.members > 2) "s" else ""}" else ""}. Your music follows theirs while you're in."
          is Offer.OtherLibrary -> "Joining needs the same library: ${o.host}'s songs come from a Navidrome server you aren't connected to."
          is Offer.Gone -> "This listening session has ended."
          is Offer.Failed -> "Couldn't join. Try again."
        },
        color = Chamber.muted,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(top = 4.dp, bottom = 18.dp).semantics { liveRegion = LiveRegionMode.Polite },
      )
      if (o is Offer.Ready) {
        SignButton("Join", primary = true) { t.join(o.id) }
        Spacer(Modifier.height(10.dp))
      }
      SignButton("Not now", primary = false) { t.dismissOffer() }
      Spacer(Modifier.height(24.dp))
    }
  }
}

/** Opening `<origin>/together/<id>` (a link, a scan from another app): its session's id. */
fun togetherLinkId(data: String?, base: String): String? = data?.let { togetherIdOf(it, base) }
