package com.folk3s.echo.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.api.Guest
import com.folk3s.echo.api.GuestCode
import com.folk3s.echo.api.GuestMe
import com.folk3s.echo.api.approveGuest
import com.folk3s.echo.api.askToKeep
import com.folk3s.echo.api.createGuestCode
import com.folk3s.echo.api.endGuest
import com.folk3s.echo.api.guestMe
import com.folk3s.echo.api.guests
import com.folk3s.echo.api.timeLeftText
import com.folk3s.echo.echo
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

// Guest accounts in the app (src/server/guests.ts): the guest's banner and its "Keep account"; for
// everyone else, inviting a guest (a QR code) and their guests to keep or end.

/** Who this phone is signed in as: a guest (when it ends) or a normal user (null). */
class GuestState(private val app: EchoApp) {
  private val _me = MutableStateFlow<GuestMe?>(null)
  val me: StateFlow<GuestMe?> = _me
  private val _requests = MutableStateFlow<List<Guest>>(emptyList())
  /** Guests this user invited who asked to keep their account. */
  val requests: StateFlow<List<Guest>> = _requests

  val isGuest: Boolean get() = _me.value != null
  /** Requests put off with "Not now", until the app restarts. */
  private val later = mutableSetOf<Long>()

  fun notNow(id: Long) {
    later += id
    _requests.value = _requests.value.filter { it.id != id }
  }

  suspend fun refresh() {
    if (app.tokens.token.value == null) {
      _me.value = null
      _requests.value = emptyList()
      return
    }
    _me.value = runCatching { app.api.guestMe() }.getOrNull()
    _requests.value = if (_me.value == null) runCatching { app.api.guests().filter { it.keep != null && it.id !in later } }.getOrDefault(emptyList()) else emptyList()
  }

  fun clear() {
    _me.value = null
    _requests.value = emptyList()
  }
}

/** Ticks once a second while shown, for countdowns. */
@Composable
private fun rememberNow(): Long {
  var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
  LaunchedEffect(Unit) {
    while (true) {
      delay(1000)
      now = System.currentTimeMillis()
    }
  }
  return now
}

/** A ring that empties as the time runs out. */
@Composable
private fun TimeRing(fraction: Float, modifier: Modifier = Modifier) {
  Canvas(modifier.size(34.dp)) {
    val s = Stroke(4.dp.toPx(), cap = StrokeCap.Round)
    val inset = s.width / 2
    drawArc(Color.White.copy(alpha = 0.15f), 0f, 360f, false, Offset(inset, inset), Size(size.width - s.width, size.height - s.width), style = s)
    drawArc(SIGN_AMBER, -90f, 360f * fraction.coerceIn(0f, 1f), false, Offset(inset, inset), Size(size.width - s.width, size.height - s.width), style = s)
  }
}

/** The guest's bar on Home: the time left, who invited them, and "Keep account". */
@Composable
fun GuestBanner() {
  val app = LocalContext.current.echo
  val me by app.guests.me.collectAsStateWithLifecycle()
  val g = me ?: return
  val now = rememberNow()
  var asking by remember { mutableStateOf(false) }
  val left = g.expiresAt - now
  // The ring shows the share of a day left (a week's pass starts full and stays full a while).
  val fraction = (left / 86_400_000f).coerceIn(0.04f, 1f)
  Row(
    Modifier.padding(horizontal = 14.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp))
      .background(Brush.horizontalGradient(listOf(SIGN_AMBER.copy(alpha = 0.22f), SIGN_ROSE.copy(alpha = 0.22f))))
      .border(1.dp, SIGN_AMBER.copy(alpha = 0.35f), RoundedCornerShape(18.dp)).padding(10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    TimeRing(fraction)
    Column(Modifier.weight(1f)) {
      Text("Guest · ${timeLeftText(left)}", color = Chamber.text, fontWeight = FontWeight(800), fontSize = 14.sp)
      Text(
        when {
          g.keep != null -> "Asked to keep it as “${g.keep.username}”"
          g.invitedBy != null -> "Invited by ${g.invitedBy}"
          else -> "Guest account"
        },
        color = Chamber.muted,
        fontSize = 12.sp,
      )
    }
    if (g.keep == null)
      Box(Modifier.clip(CircleShape).background(SIGN_AMBER).bouncy(label = "Keep account") { asking = true }.padding(horizontal = 12.dp, vertical = 7.dp)) {
        Text("Keep account", color = Color(0xFF2A1020), fontWeight = FontWeight(800), fontSize = 12.sp)
      }
  }
  if (asking) KeepDialog(invitedBy = g.invitedBy) { asking = false }
}

/** "Keep account": a username and password; the inviter (or an admin) approves. */
@Composable
private fun KeepDialog(invitedBy: String?, onClose: () -> Unit) {
  val app = LocalContext.current.echo
  val scope = rememberCoroutineScope()
  var username by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var error by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }
  AlertDialog(
    onDismissRequest = onClose,
    title = { Text("Keep this account") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
          "Choose a username and password. ${invitedBy ?: "The person who invited you"} gets a request to approve it; your history stays.",
          color = Chamber.muted,
          style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedTextField(username, { username = it.trim() }, label = { Text("Username") }, singleLine = true)
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
      }
    },
    confirmButton = {
      TextButton(
        enabled = !busy && username.isNotBlank() && password.isNotEmpty(),
        onClick = {
          busy = true
          scope.launch {
            try {
              app.api.askToKeep(username, password)
              app.guests.refresh()
              app.playback.notify("Asked ${invitedBy ?: "your host"} to keep your account.")
              onClose()
            } catch (e: ApiError) {
              error =
                when (e.code) {
                  "username_taken" -> "That username is taken. Try another."
                  "bad_username" -> "Use letters, numbers, dots, dashes or underscores (not “guest-…”)."
                  "weak_password" -> "Choose a longer, less common password."
                  else -> "Couldn't send the request. Try again."
                }
            } catch (_: java.io.IOException) {
              error = "ECHO didn't answer. Try again."
            } finally {
              busy = false
            }
          }
        },
      ) { Text("Ask to keep") }
    },
    dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
  )
}

/** A QR code for [text], as crisp black modules on white. */
fun qrBitmap(text: String, size: Int = 600): ImageBitmap {
  val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.H, EncodeHintType.MARGIN to 0))
  val px = IntArray(m.width * m.height) { i -> if (m.get(i % m.width, i / m.width)) 0xFF111111.toInt() else 0xFFFFFFFF.toInt() }
  return android.graphics.Bitmap.createBitmap(px, m.width, m.height, android.graphics.Bitmap.Config.ARGB_8888).asImageBitmap()
}

private val DURATIONS = listOf(3_600_000L to "1 hour", 86_400_000L to "1 day", 7 * 86_400_000L to "1 week")

/** Invite a guest: a QR code they scan with the ECHO app; it lasts 10 minutes and works once. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteSheet(onClose: () -> Unit) {
  val app = LocalContext.current.echo
  var duration by remember { mutableLongStateOf(DURATIONS[1].first) }
  var code by remember { mutableStateOf<GuestCode?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  var joined by remember { mutableStateOf<String?>(null) }
  var round by remember { mutableLongStateOf(0L) }
  val now = rememberNow()
  LaunchedEffect(duration, round) {
    code = null
    error = null
    joined = null
    try {
      code = app.api.createGuestCode(duration)
    } catch (e: ApiError) {
      error = if (e.code == "too_many_codes") "You have five codes waiting. Let them run out first." else "Couldn't make a code. Try again."
    } catch (_: java.io.IOException) {
      error = "ECHO didn't answer. Try again."
    }
  }
  // While it shows, notice the guest joining.
  LaunchedEffect(code) {
    val c = code ?: return@LaunchedEffect
    val before = runCatching { app.api.guests().map { it.id }.toSet() }.getOrDefault(emptySet())
    while (System.currentTimeMillis() < c.expiresAt && joined == null) {
      delay(3000)
      val fresh = runCatching { app.api.guests() }.getOrNull()?.firstOrNull { it.id !in before }
      if (fresh != null) joined = fresh.username
    }
  }
  ModalBottomSheet(onDismissRequest = onClose) {
    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 22.dp, vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("Invite a guest", style = MaterialTheme.typography.titleLarge, modifier = Modifier.fillMaxWidth())
      Text(
        "Let someone try ECHO on their phone: they open the ECHO app, tap “Scan a guest code” and point it here.",
        color = Chamber.muted,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 16.dp),
      )
      Box(
        Modifier.size(232.dp).clip(RoundedCornerShape(26.dp)).background(Color.White).border(6.dp, SIGN_AMBER.copy(alpha = 0.3f), RoundedCornerShape(26.dp)).padding(18.dp),
        contentAlignment = Alignment.Center,
      ) {
        val c = code
        when {
          joined != null -> Text("✓\n$joined joined", color = Color(0xFF2A1020), fontWeight = FontWeight(800), fontSize = 18.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
          c != null && now < c.expiresAt -> {
            val bmp = remember(c.url) { qrBitmap(c.url) }
            Image(bmp, "Guest QR code", Modifier.fillMaxWidth(), filterQuality = FilterQuality.None)
            Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).background(Color.White).padding(4.dp).clip(RoundedCornerShape(9.dp)).background(SIGN_GROUND), contentAlignment = Alignment.Center) {
              Text("ECHO", color = SIGN_AMBER, fontWeight = FontWeight(900), fontSize = 11.sp)
            }
          }
          c != null -> OutlinedButton(onClick = { round++ }) { Text("New code") }
          error != null -> Text(error!!, color = Color(0xFF8A2030), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
          else -> Text("…", color = Color(0xFF2A1020))
        }
      }
      Row(Modifier.padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((ms, label) in DURATIONS) FilterChip(selected = duration == ms, onClick = { duration = ms }, label = { Text(label) })
      }
      val c = code
      Text(
        when {
          joined != null -> "They're in. They can listen for ${DURATIONS.firstOrNull { it.first == duration }?.second ?: ""}."
          c != null && now < c.expiresAt -> "Code works once, for ${((c.expiresAt - now) / 1000).let { "%d:%02d".format(it / 60, it % 60) }}"
          c != null -> "This code ran out."
          else -> " "
        },
        color = Chamber.muted,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.padding(top = 12.dp, bottom = 20.dp),
      )
    }
  }
}

/** Settings → Guests: invite one, and the guests this user invited, to keep or end. */
@Composable
fun GuestsSection() {
  val app = LocalContext.current.echo
  val scope = rememberCoroutineScope()
  var inviting by remember { mutableStateOf(false) }
  var list by remember { mutableStateOf<List<Guest>?>(null) }
  var reload by remember { mutableLongStateOf(0L) }
  val now = rememberNow()
  LaunchedEffect(reload, inviting) { if (!inviting) list = runCatching { app.api.guests() }.getOrNull() }
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    OutlinedButton(onClick = { inviting = true }) { Text("Invite a guest") }
    Text("Show a QR code; whoever scans it with the ECHO app can listen for an hour, a day or a week.", color = Chamber.muted, style = MaterialTheme.typography.bodySmall)
    for (g in list.orEmpty()) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(SIGN_AMBER), contentAlignment = Alignment.Center) {
          Text((g.keep?.username ?: g.username).take(1).uppercase(), color = Color(0xFF2A1020), fontWeight = FontWeight(900))
        }
        Column(Modifier.weight(1f)) {
          Text(g.keep?.let { "${it.username} (wants to stay)" } ?: g.username, style = MaterialTheme.typography.bodyLarge)
          Text("Guest · ${timeLeftText(g.expiresAt - now)}", color = Chamber.muted, style = MaterialTheme.typography.bodySmall)
        }
        if (g.keep != null)
          TextButton(onClick = {
            scope.launch {
              runCatching { app.api.approveGuest(g.id) }.onSuccess { app.playback.notify("${g.keep.username} is now a full account.") }.onFailure { app.playback.notify("Couldn't approve. The name may be taken now.") }
              app.guests.refresh()
              reload++
            }
          }) { Text("Approve") }
        TextButton(onClick = {
          scope.launch {
            runCatching { app.api.endGuest(g.id) }
            reload++
          }
        }) { Text("End now") }
      }
    }
  }
  if (inviting) InviteSheet { inviting = false }
}

/** Home, for an inviter: a guest asks to keep their account. */
@Composable
fun KeepRequestsCard() {
  val app = LocalContext.current.echo
  val scope = rememberCoroutineScope()
  val requests by app.guests.requests.collectAsStateWithLifecycle()
  val g = requests.firstOrNull() ?: return
  Column(
    Modifier.padding(horizontal = 14.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Chamber.surface2)
      .border(1.dp, SIGN_AMBER.copy(alpha = 0.35f), RoundedCornerShape(22.dp)).padding(14.dp),
    verticalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Text("${g.keep?.username} wants to keep their account", color = Chamber.text, fontWeight = FontWeight(800), fontSize = 15.sp)
    Text("Guest ${g.username} · ${timeLeftText(g.expiresAt - System.currentTimeMillis())}", color = Chamber.muted, fontSize = 12.sp)
    Spacer(Modifier.height(6.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Box(Modifier.weight(1f).height(42.dp).clip(CircleShape).background(SIGN_AMBER).bouncy(label = "Approve") {
        scope.launch {
          runCatching { app.api.approveGuest(g.id) }.onSuccess { app.playback.notify("${g.keep?.username} is now a full account.") }.onFailure { app.playback.notify("Couldn't approve. The name may be taken now.") }
          app.guests.refresh()
        }
      }, contentAlignment = Alignment.Center) { Text("Approve", color = Color(0xFF2A1020), fontWeight = FontWeight(800)) }
      Box(Modifier.weight(1f).height(42.dp).clip(CircleShape).border(1.dp, Chamber.line, CircleShape).bouncy(label = "Not now") {
        app.guests.notNow(g.id)
      }, contentAlignment = Alignment.Center) { Text("Not now", color = Chamber.text, fontWeight = FontWeight(800)) }
    }
    Spacer(Modifier.width(1.dp))
  }
}
