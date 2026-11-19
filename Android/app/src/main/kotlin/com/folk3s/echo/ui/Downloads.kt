package com.folk3s.echo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.echo
import com.folk3s.echo.offline.DownloadState
import com.folk3s.echo.offline.ItemStatus
import com.folk3s.echo.offline.OfflineItem
import com.folk3s.echo.offline.formatBytes

// Offline downloads on screen (v0.8): the download button on album, playlist and Liked Songs
// pages, the Downloads page (Library → Downloads, and Home while ECHO can't be reached), and the
// offline note.

/** A page's download state, kept current as files arrive. */
@Composable
fun rememberDownloadStatus(kind: String, id: String): ItemStatus {
  val app = LocalContext.current.echo
  val idx by app.downloads.index.collectAsStateWithLifecycle()
  val now by app.downloads.fetching.collectAsStateWithLifecycle()
  return remember(idx, now, kind, id) { app.downloads.status(kind, id, idx, now) }
}

/** Whether ECHO can be reached now. */
@Composable
fun rememberOnline(): Boolean {
  val online by LocalContext.current.echo.network.online.collectAsStateWithLifecycle()
  return online
}

/** The ⋯ menu's line for a page's download: Download, Cancel download or Remove download. */
fun downloadMenuItem(app: EchoApp, status: ItemStatus, kind: String, id: String, onDownload: () -> Unit): Pair<String, () -> Unit> =
  when (status.state) {
    DownloadState.None -> "Download" to onDownload
    DownloadState.Done -> "Remove download" to { app.downloads.remove(kind, id) }
    else -> "Cancel download" to { app.downloads.remove(kind, id) }
  }

/**
 * The download button in a page's top bar: an arrow to download; a ring filling while it
 * downloads (tap to cancel); a filled disc once it's all on the phone (tap to remove, asked first).
 */
@Composable
fun DownloadButton(kind: String, id: String, title: String, onDownload: () -> Unit) {
  val app = LocalContext.current.echo
  val status = rememberDownloadStatus(kind, id)
  val haptics = rememberHaptics()
  var confirm by remember { mutableStateOf(false) }
  val label =
    when (status.state) {
      DownloadState.None -> "Download $title"
      DownloadState.Done -> "Downloaded. Remove the download of $title"
      else -> "Downloading $title, ${status.done} of ${status.total}. Cancel"
    }
  Box(
    Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable {
      haptics.tap()
      when (status.state) {
        DownloadState.None -> onDownload()
        DownloadState.Done -> confirm = true
        else -> {
          app.downloads.remove(kind, id)
          app.playback.notify("Download cancelled")
        }
      }
    }.semantics { contentDescription = label },
    contentAlignment = Alignment.Center,
  ) {
    when (status.state) {
      DownloadState.None -> Icon(EchoIcons.download, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
      DownloadState.Done ->
        Box(Modifier.size(28.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
          Icon(EchoIcons.download, null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(18.dp))
        }
      else -> {
        CircularProgressIndicator(
          progress = { status.progress },
          modifier = Modifier.size(28.dp),
          strokeWidth = 2.5.dp,
          trackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f),
        )
        Icon(EchoIcons.download, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(14.dp))
      }
    }
  }
  if (confirm)
    AlertDialog(
      onDismissRequest = { confirm = false },
      title = { Text("Remove download?") },
      text = { Text("“$title” won't play without a connection any more.") },
      confirmButton = {
        TextButton(onClick = {
          confirm = false
          app.downloads.remove(kind, id)
        }) { Text("Remove", color = Chamber.negative) }
      },
      dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel", color = Chamber.text) } },
      containerColor = Chamber.surface3,
    )
}

/** Why the downloads aren't moving, when they aren't: no connection, or waiting for Wi-Fi. */
@Composable
private fun waitingReason(): String? {
  val app = LocalContext.current.echo
  val connected by app.network.connected.collectAsStateWithLifecycle()
  val unmetered by app.network.unmetered.collectAsStateWithLifecycle()
  val prefs by app.prefs.state.collectAsStateWithLifecycle()
  return when {
    !connected -> "Waiting for a connection"
    prefs.downloadWifiOnly && !unmetered -> "Waiting for Wi-Fi"
    else -> null
  }
}

/** The slim note over the page while ECHO can't be reached. */
@Composable
fun OfflineNote(modifier: Modifier = Modifier, onDownloads: (() -> Unit)? = null) {
  Surface(
    modifier.then(if (onDownloads != null) Modifier.clip(CircleShape).clickable(onClick = onDownloads) else Modifier),
    CircleShape,
    MaterialTheme.colorScheme.inverseSurface,
    MaterialTheme.colorScheme.inverseOnSurface,
  ) {
    Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Icon(EchoIcons.offline, null, modifier = Modifier.size(18.dp))
      Text("Offline · your downloads still play", style = MaterialTheme.typography.labelLarge)
    }
  }
}

private fun contextOf(i: OfflineItem) =
  if (i.kind == "liked") PlayContext("starred", title = "Liked Songs") else PlayContext(i.kind, i.id, i.title)

private fun routeOf(i: OfflineItem): Route =
  when (i.kind) {
    "album" -> Route.Album(i.id)
    "playlist" -> Route.Playlist(i.id)
    else -> Route.Liked
  }

/**
 * The downloads as a list: what's on the phone and how much room it takes, each album or playlist
 * to open or play, and Remove all. [header] goes on top (the page bar, or Home's title offline).
 */
@Composable
fun DownloadsList(nav: Nav, header: @Composable () -> Unit) {
  val app = LocalContext.current.echo
  val idx by app.downloads.index.collectAsStateWithLifecycle()
  val now by app.downloads.fetching.collectAsStateWithLifecycle()
  val waiting = waitingReason()
  var clearing by remember { mutableStateOf(false) }
  val pending = idx.items.count { !idx.complete(it) }
  LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
    item("header") { header() }
    item("summary") {
      val n = idx.items.size
      Column(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
        if (n > 0)
          Text(
            "$n ${if (n == 1) "download" else "downloads"} · ${formatBytes(idx.totalBytes)} on this phone",
            color = Chamber.muted,
            style = MaterialTheme.typography.bodyMedium,
          )
        if (pending > 0 && now == null && waiting != null)
          Text(waiting, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 2.dp))
      }
    }
    if (idx.items.isEmpty())
      item("empty") { Empty("Download albums and playlists to play them with no connection: tap the download button at the top of an album or playlist.") }
    items(idx.items, key = { it.key }) { i ->
      val st = app.downloads.status(i.kind, i.id, idx, now)
      Row(
        Modifier.fillMaxWidth().clickable { nav.go(routeOf(i)) }.padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
      ) {
        if (i.kind == "liked") LikedArt(56) else Artwork(i.cover ?: i.tracks.firstOrNull()?.cover, i.title, 56.dp)
        Column(Modifier.weight(1f)) {
          Text(i.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
          val kind = when (i.kind) { "album" -> "Album"; "playlist" -> "Playlist"; else -> "Liked Songs" }
          val sub =
            when (st.state) {
              DownloadState.Done -> listOfNotNull(kind.takeIf { i.kind != "liked" }, i.subtitle, "${i.tracks.size} songs", formatBytes(idx.bytes(i))).joinToString(" · ")
              DownloadState.Downloading -> "Downloading · ${st.done} of ${st.total}"
              else -> "${waiting ?: "Queued"} · ${st.done} of ${st.total}"
            }
          Text(sub, color = Chamber.muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
          if (st.state == DownloadState.Downloading || st.state == DownloadState.Queued)
            LinearProgressIndicator(progress = { st.progress }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp).clip(RoundedCornerShape(2.dp)))
        }
        val ctx = contextOf(i)
        IconBtn(EchoIcons.play, "Play ${i.title}", MaterialTheme.colorScheme.primary, 22) { app.playback.playList(i.tracks, 0, ctx) }
        MoreMenu(
          "More for ${i.title}",
          listOf(
            "Play" to { app.playback.playList(i.tracks, 0, ctx) },
            "Shuffle" to { app.playback.playList(i.tracks.shuffled(), 0, ctx) },
            (if (st.state == DownloadState.Done) "Remove download" else "Cancel download") to { app.downloads.remove(i.kind, i.id) },
          ),
        )
      }
    }
    if (idx.items.isNotEmpty())
      item("clear") {
        OutlinedButton(onClick = { clearing = true }, modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) { Text("Remove all downloads") }
      }
  }
  if (clearing)
    AlertDialog(
      onDismissRequest = { clearing = false },
      title = { Text("Remove all downloads?") },
      text = { Text("${formatBytes(idx.totalBytes)} of music leaves this phone. It stays in your library to stream.") },
      confirmButton = {
        TextButton(onClick = {
          clearing = false
          app.downloads.removeAll()
        }) { Text("Remove all", color = Chamber.negative) }
      },
      dismissButton = { TextButton(onClick = { clearing = false }) { Text("Cancel", color = Chamber.text) } },
      containerColor = Chamber.surface3,
    )
}

/** Library → Downloads. */
@Composable
fun DownloadsScreen(nav: Nav) =
  DownloadsList(nav) {
    PageBar(nav)
    LargeTitle("Downloads")
  }

/** Home while ECHO can't be reached: the downloads, ready to play. */
@Composable
fun OfflineHome(nav: Nav, onProfile: () -> Unit) =
  DownloadsList(nav) {
    LargeTitle("Home") { Avatar(onProfile) }
    OfflineNote(Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
    SectionTitle("Your downloads", Modifier.padding(top = 12.dp))
  }

/** Settings → Downloads: Wi-Fi only, the room it takes, and the list. */
@Composable
fun DownloadsSettings(onManage: (() -> Unit)?) {
  val app = LocalContext.current.echo
  val p by app.prefs.state.collectAsStateWithLifecycle()
  val idx by app.downloads.index.collectAsStateWithLifecycle()
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text("Download only on Wi-Fi", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
      androidx.compose.material3.Switch(p.downloadWifiOnly, { v -> app.prefs.update { it.copy(downloadWifiOnly = v) } })
    }
    Text(
      "Albums and playlists you download play with no connection, as Opus at 192 kbps.",
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      style = MaterialTheme.typography.bodySmall,
    )
    val n = idx.items.size
    Text(
      if (n == 0) "Nothing downloaded yet" else "${formatBytes(idx.totalBytes)} used by $n ${if (n == 1) "download" else "downloads"}",
      style = MaterialTheme.typography.bodyMedium,
    )
    if (onManage != null) OutlinedButton(onClick = onManage) { Text("Manage downloads") }
  }
}
