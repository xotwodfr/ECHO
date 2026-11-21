package com.folk3s.echo.ui

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.echo
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request

// Sign in (v0.7): the library's covers drift slowly behind a frosted card, as if the music were
// already playing. The covers are the ones this phone saw while signed in (kept in its own files,
// never shown to anyone else); before that, coloured tiles stand in. A guest code can be scanned
// from here (GuestScan.kt).

/** ECHO's sign-in colours: warm amber into rose, over a deep ground. */
internal val SIGN_AMBER = Color(0xFFFFB36B)
internal val SIGN_ROSE = Color(0xFFFF6F91)
internal val SIGN_VIOLET = Color(0xFFB18CF0)
internal val SIGN_GROUND = Color(0xFF121014)
private val SIGN_INK = Color(0xFF2A1020)

/** Covers kept for the sign-in wall: the album art this phone showed while signed in. */
object CoverWall {
  private const val MAX = 24
  private const val EVERY_MS = 24 * 3_600_000L

  private fun dir(ctx: Context) = File(ctx.filesDir, "wall").apply { mkdirs() }

  fun load(ctx: Context): List<ImageBitmap> =
    runCatching {
        dir(ctx).listFiles { f -> f.extension == "jpg" }.orEmpty().sortedBy { it.name }.mapNotNull { f ->
          BitmapFactory.decodeFile(f.path)?.asImageBitmap()
        }
      }
      .getOrDefault(emptyList())

  /** Keeps up to 24 small covers from the library, at most once a day (not for a guest's phone). */
  suspend fun refresh(app: EchoApp, covers: List<String>) {
    val sp = app.getSharedPreferences("echo.wall", Context.MODE_PRIVATE)
    if (covers.isEmpty() || System.currentTimeMillis() - sp.getLong("at", 0) < EVERY_MS) return
    withContext(Dispatchers.IO) {
      val d = dir(app)
      covers.distinct().shuffled().take(MAX).forEachIndexed { i, path ->
        runCatching {
          val url = app.api.url(path.replace(Regex("size=\\d+"), "size=200"))
          app.api.http.newCall(Request.Builder().url(url).build()).execute().use { res ->
            if (res.isSuccessful) File(d, "c%02d.jpg".format(i)).writeBytes(res.body.bytes())
          }
        }
      }
      sp.edit().putLong("at", System.currentTimeMillis()).apply()
    }
  }
}

private val TILES =
  listOf(
    listOf(Color(0xFFFF8A7A), Color(0xFFFFC88A)),
    listOf(Color(0xFF7A9CF0), Color(0xFFB18CF0)),
    listOf(Color(0xFF59C9A5), Color(0xFFA6E3A1)),
    listOf(Color(0xFFF57FA8), Color(0xFF8A8CF5)),
    listOf(Color(0xFF2B2D6E), Color(0xFFE05D8A)),
    listOf(Color(0xFFF2C14E), Color(0xFFE0603A)),
    listOf(Color(0xFF1F4037), Color(0xFF99F2C8)),
    listOf(Color(0xFF3A1C71), Color(0xFFD76D77)),
  )

/** The wall: five tilted columns of covers, each drifting slowly up or down (still with reduced motion). */
@Composable
private fun Wall(covers: List<ImageBitmap>, still: Boolean) {
  val drift = rememberInfiniteTransition(label = "wall")
  val t by drift.animateFloat(0f, 1f, infiniteRepeatable(tween(60_000, easing = LinearEasing), RepeatMode.Reverse), label = "t")
  BoxWithConstraints(Modifier.fillMaxSize()) {
    val tile = 104.dp
    val gap = 12.dp
    Row(
      Modifier.requiredSize(maxWidth * 1.7f, maxHeight * 1.5f).graphicsLayer { rotationZ = -12f },
      horizontalArrangement = Arrangement.spacedBy(gap, Alignment.CenterHorizontally),
    ) {
      for (col in 0 until 6) {
        val dir = if (col % 2 == 0) 1f else -1f
        val shift = if (still) 0f else (t - 0.5f) * 220f * dir
        Column(
          Modifier.offset(y = (shift - col * 37 % 90).dp),
          verticalArrangement = Arrangement.spacedBy(gap),
        ) {
          for (row in 0 until 9) {
            val i = col * 9 + row
            val m = Modifier.size(tile).shadow(10.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp))
            if (covers.isNotEmpty()) Image(covers[(i * 7) % covers.size], null, m, contentScale = ContentScale.Crop)
            else Box(m.background(Brush.linearGradient(TILES[(i * 5 + col) % TILES.size])))
          }
        }
      }
    }
    // Dark toward the card, so the form reads; the covers glow through at the top.
    Box(
      Modifier.fillMaxSize().background(
        Brush.verticalGradient(0f to SIGN_GROUND.copy(alpha = 0.25f), 0.4f to SIGN_GROUND.copy(alpha = 0.55f), 0.68f to SIGN_GROUND.copy(alpha = 0.94f), 1f to SIGN_GROUND),
      ),
    )
  }
}

/** The ECHO wordmark in its gradient, rising in when the screen opens. */
@Composable
private fun Logo(still: Boolean, server: String) {
  val rise = remember { Animatable(if (still) 1f else 0f) }
  LaunchedEffect(Unit) { rise.animateTo(1f, spring(dampingRatio = 0.7f, stiffness = 120f)) }
  Column(
    Modifier.fillMaxWidth().graphicsLayer {
      alpha = rise.value
      translationY = (1f - rise.value) * 40f
      scaleX = 0.92f + 0.08f * rise.value
      scaleY = 0.92f + 0.08f * rise.value
    },
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      "ECHO",
      style = TextStyle(brush = Brush.linearGradient(listOf(SIGN_AMBER, SIGN_ROSE, SIGN_VIOLET)), fontSize = 52.sp, fontWeight = FontWeight(900), letterSpacing = (-1).sp, fontFamily = Figtree),
    )
    Text(server, color = Color.White.copy(alpha = 0.65f), fontSize = 13.sp, fontFamily = Figtree)
  }
}

@Composable
private fun SignField(value: String, onChange: (String) -> Unit, label: String, enabled: Boolean, password: Boolean = false, ime: ImeAction, onIme: () -> Unit = {}, keyboard: KeyboardType = KeyboardType.Ascii) {
  OutlinedTextField(
    value,
    onChange,
    label = { Text(label) },
    singleLine = true,
    enabled = enabled,
    shape = RoundedCornerShape(16.dp),
    visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
    keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboard, imeAction = ime, autoCorrectEnabled = false),
    keyboardActions = KeyboardActions(onNext = { onIme() }, onDone = { onIme() }),
    colors =
      OutlinedTextFieldDefaults.colors(
        focusedBorderColor = SIGN_AMBER,
        unfocusedBorderColor = Color.White.copy(alpha = 0.16f),
        focusedLabelColor = SIGN_AMBER,
        unfocusedLabelColor = Color.White.copy(alpha = 0.6f),
        focusedTextColor = Color.White,
        unfocusedTextColor = Color.White,
        disabledTextColor = Color.White.copy(alpha = 0.6f),
        disabledBorderColor = Color.White.copy(alpha = 0.1f),
        disabledLabelColor = Color.White.copy(alpha = 0.4f),
        cursorColor = SIGN_AMBER,
        focusedContainerColor = Color.White.copy(alpha = 0.08f),
        unfocusedContainerColor = Color.White.copy(alpha = 0.06f),
        disabledContainerColor = Color.White.copy(alpha = 0.04f),
      ),
    modifier = Modifier.fillMaxWidth(),
  )
}

/** A pill: the gradient for the main action, an outline for the other. */
@Composable
internal fun SignButton(label: String, primary: Boolean, enabled: Boolean = true, icon: androidx.compose.ui.graphics.vector.ImageVector? = null, onClick: () -> Unit) {
  Box(
    Modifier.fillMaxWidth().height(52.dp).bouncy(enabled = enabled, scale = 0.97f, label = label, onClick = onClick)
      .clip(CircleShape)
      .then(if (primary) Modifier.background(Brush.horizontalGradient(listOf(SIGN_AMBER, SIGN_ROSE))) else Modifier.border(1.dp, Color.White.copy(alpha = 0.24f), CircleShape))
      .graphicsLayer { alpha = if (enabled) 1f else 0.6f },
    contentAlignment = Alignment.Center,
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      if (icon != null) {
        Icon(icon, null, tint = if (primary) SIGN_INK else Color.White, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
      }
      Text(label, color = if (primary) SIGN_INK else Color.White, fontWeight = FontWeight(800), fontSize = 16.sp, fontFamily = Figtree)
    }
  }
}

/**
 * Sign in (S0): this device gets its own token, listed in Sessions & devices. With two-factor on,
 * the server answers `totp_required` and the code field appears; both go in one request.
 */
@Composable
fun SignInScreen() {
  val app = LocalContext.current.echo
  val scope = rememberCoroutineScope()
  val ctx = LocalContext.current
  val still = app.prefs.reducedMotion()
  val covers = remember { CoverWall.load(ctx) }
  var scanning by remember { mutableStateOf(false) }
  var username by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var code by remember { mutableStateOf("") }
  var needsCode by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var shakes by remember { mutableIntStateOf(0) }
  val shake = remember { Animatable(0f) }
  LaunchedEffect(shakes) {
    if (shakes == 0 || still) return@LaunchedEffect
    // A gentle shake: three quick swings, settling.
    for (x in listOf(14f, -11f, 8f, -5f, 2f, 0f)) shake.animateTo(x, tween(55))
  }

  fun submit() {
    if (busy || username.isBlank() || password.isEmpty() || (needsCode && code.isBlank())) return
    busy = true
    error = null
    scope.launch {
      try {
        app.api.signIn(username.trim(), password, code.takeIf { needsCode })
      } catch (e: ApiError) {
        when {
          e.code == "totp_required" -> needsCode = true
          e.code == "bad_code" -> error = "That code did not work. Try the current one."
          e.status == 429 -> error = "Too many attempts. Wait a minute and try again."
          e.status == 401 -> error = "Username or password is incorrect."
          // Not about the password: the server (or the proxy in front of it) refused the request.
          else -> error = "ECHO refused the sign-in (${e.code ?: "HTTP ${e.status}"}). Its proxy setup may need a look; your password wasn't checked."
        }
        if (error != null) shakes++
      } catch (e: java.io.IOException) {
        error = "ECHO didn't answer. Check the connection and try again."
        shakes++
      } finally {
        busy = false
      }
    }
  }

  Box(Modifier.fillMaxSize().background(SIGN_GROUND)) {
    Wall(covers, still)
    AnimatedContent(scanning, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(160)) }, label = "scan") { scan ->
      if (scan) GuestScanScreen(onBack = { scanning = false })
      else
        Column(
          Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          Spacer(Modifier.weight(1f).height(180.dp))
          Logo(still, app.api.base.substringAfter("://"))
          Spacer(Modifier.height(28.dp))
          Column(
            Modifier.widthIn(max = 440.dp).fillMaxWidth()
              .offset { androidx.compose.ui.unit.IntOffset(shake.value.dp.roundToPx(), 0) }
              .shadow(28.dp, RoundedCornerShape(30.dp), ambientColor = Color.Black, spotColor = Color.Black)
              .clip(RoundedCornerShape(30.dp))
              .background(Color(0xFF28242E).copy(alpha = 0.86f))
              .border(1.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.22f), Color.White.copy(alpha = 0.04f))), RoundedCornerShape(30.dp))
              .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
          ) {
            if (needsCode) Text("Two-factor code", color = Color.White, fontWeight = FontWeight(800), fontSize = 18.sp, fontFamily = Figtree)
            SignField(username, { username = it }, "Username", enabled = !needsCode, ime = ImeAction.Next)
            SignField(password, { password = it }, "Password", enabled = !needsCode, password = true, ime = if (needsCode) ImeAction.Next else ImeAction.Done, onIme = { if (!needsCode) submit() })
            if (needsCode) SignField(code, { code = it }, "6-digit code or recovery code", enabled = true, ime = ImeAction.Done, onIme = ::submit)
            error?.let {
              Text(it, color = Color(0xFFFFA4A4), fontSize = 14.sp, fontFamily = Figtree, modifier = Modifier.padding(horizontal = 4.dp).semantics { liveRegion = LiveRegionMode.Assertive })
            }
            Spacer(Modifier.height(2.dp))
            SignButton(if (busy) "Signing in…" else if (needsCode) "Verify" else "Sign in", primary = true, enabled = !busy, onClick = ::submit)
            if (!needsCode) SignButton("Scan a guest code", primary = false, icon = EchoIcons.qr) { scanning = true }
          }
          Spacer(Modifier.height(18.dp))
        }
    }
  }
}

