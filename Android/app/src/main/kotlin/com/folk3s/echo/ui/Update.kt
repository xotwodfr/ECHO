package com.folk3s.echo.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folk3s.echo.BuildConfig
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.echo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

// The update notice: once a day the app asks GitHub for ECHO's latest release; a newer version
// shows a card on Home with its download. "Later" hides that version's card for good.

const val RELEASES_API = "https://api.github.com/repos/xotwodfr/ECHO/releases/latest"

/** Whether `latest` ("v0.8.0", "0.8.0") is newer than `current` ("0.7.0"), part by part. */
fun isNewer(latest: String, current: String): Boolean {
  fun parts(v: String) = v.trim().removePrefix("v").split('.', '-').map { it.toIntOrNull() ?: 0 }
  val a = parts(latest)
  val b = parts(current)
  for (i in 0 until maxOf(a.size, b.size)) {
    val x = a.getOrElse(i) { 0 }
    val y = b.getOrElse(i) { 0 }
    if (x != y) return x > y
  }
  return false
}

private data class Release(val version: String, val apk: String?, val page: String)

private suspend fun latestRelease(ctx: Context): Release? {
  val sp = ctx.getSharedPreferences("echo.update", Context.MODE_PRIVATE)
  val now = System.currentTimeMillis()
  // Asked at most once a day; the answer kept in between.
  if (now - sp.getLong("at", 0) < 86_400_000L) {
    val v = sp.getString("version", null) ?: return null
    return Release(v, sp.getString("apk", null), sp.getString("page", "") ?: "")
  }
  return withContext(Dispatchers.IO) {
    runCatching {
        // A plain client: no ECHO token goes to GitHub.
        OkHttpClient().newCall(Request.Builder().url(RELEASES_API).header("Accept", "application/vnd.github+json").build()).execute().use { res ->
          if (!res.isSuccessful) return@use null
          val o = EchoJson.parseToJsonElement(res.body.string()).jsonObject
          val tag = o["tag_name"]?.jsonPrimitive?.contentOrNull ?: return@use null
          val page = o["html_url"]?.jsonPrimitive?.contentOrNull ?: ""
          val apk =
            (o["assets"] as? kotlinx.serialization.json.JsonArray)?.map { it.jsonObject }?.firstOrNull { it["name"]?.jsonPrimitive?.contentOrNull?.endsWith(".apk") == true }
              ?.get("browser_download_url")?.jsonPrimitive?.contentOrNull
          sp.edit().putLong("at", now).putString("version", tag).putString("apk", apk).putString("page", page).apply()
          Release(tag, apk, page)
        }
      }
      .getOrNull()
  }
}

/** Home: "ECHO 0.8.0 is out", with Download and Later. */
@Composable
fun UpdateCard() {
  val app = LocalContext.current.echo
  val ctx = LocalContext.current
  var release by remember { mutableStateOf<Release?>(null) }
  var hidden by remember { mutableStateOf(false) }
  LaunchedEffect(Unit) {
    val r = latestRelease(ctx) ?: return@LaunchedEffect
    val later = ctx.getSharedPreferences("echo.update", Context.MODE_PRIVATE).getString("later", null)
    if (isNewer(r.version, BuildConfig.VERSION_NAME) && later != r.version) release = r
  }
  val r = release ?: return
  if (hidden) return
  Column(
    Modifier.padding(horizontal = 14.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Chamber.surface2)
      .border(1.dp, Chamber.line, RoundedCornerShape(22.dp)).padding(14.dp),
    verticalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Text("ECHO ${r.version.removePrefix("v")} is out", color = Chamber.text, fontWeight = FontWeight(800), fontSize = 15.sp)
    Text("You have ${BuildConfig.VERSION_NAME}. Download the new version, uninstall this one, then install it.", color = Chamber.muted, fontSize = 12.sp)
    Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Box(
        Modifier.weight(1f).height(42.dp).clip(CircleShape).background(MaterialColorsAccent()).bouncy(label = "Download") {
          runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(r.apk ?: r.page)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        },
        contentAlignment = Alignment.Center,
      ) { Text("Download", color = Color.White, fontWeight = FontWeight(800)) }
      Box(
        Modifier.weight(1f).height(42.dp).clip(CircleShape).border(1.dp, Chamber.line, CircleShape).bouncy(label = "Later") {
          ctx.getSharedPreferences("echo.update", Context.MODE_PRIVATE).edit().putString("later", r.version).apply()
          hidden = true
        },
        contentAlignment = Alignment.Center,
      ) { Text("Later", color = Chamber.text, fontWeight = FontWeight(800)) }
    }
  }
}

@Composable
private fun MaterialColorsAccent(): Color = androidx.compose.material3.MaterialTheme.colorScheme.primary
