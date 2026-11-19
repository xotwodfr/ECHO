package com.folk3s.echo.offline

import android.net.Uri
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.Album
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.Playlist
import com.folk3s.echo.api.PlaylistDetail
import com.folk3s.echo.api.Track
import java.io.File
import java.io.IOException
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Request

/** How a downloadable page stands: not downloaded, on its way (or waiting), or all on the phone. */
enum class DownloadState { None, Queued, Downloading, Done }

data class ItemStatus(val state: DownloadState, val done: Int = 0, val total: Int = 0, val progress: Float = 0f)

/** The track being fetched now, and how far along it is (0..1; 0 while the size is unknown). */
data class Fetching(val trackId: String, val fraction: Float)

/**
 * Offline downloads (v0.8). The list of what is downloaded lives in `files/offline/index.json`;
 * tracks in `files/offline/tracks/<id>.opus`, covers in `files/offline/covers/<id>.jpg`, all
 * app-private. [DownloadWorker] (WorkManager, so it survives the app closing) fetches what is
 * missing, one track at a time; [Playback] plays a downloaded track from its file.
 */
class Downloads(private val app: EchoApp) {
  private val root = File(app.filesDir, "offline")
  private val tracksDir = File(root, "tracks")
  private val coversDir = File(root, "covers")
  private val indexFile = File(root, "index.json")
  private val lock = Mutex()

  private val _index = MutableStateFlow(read())
  val index: StateFlow<OfflineIndex> = _index
  private val _fetching = MutableStateFlow<Fetching?>(null)
  val fetching: StateFlow<Fetching?> = _fetching

  /** Started once from [EchoApp.onCreate]: Liked Songs follows the hearts; the setting reschedules. */
  fun start() {
    app.scope.launch {
      app.library.starredFlow.filterNotNull().collect { s -> sync("liked", "liked", s.tracks) }
    }
    app.scope.launch {
      app.prefs.state.map { it.downloadWifiOnly }.distinctUntilChanged().drop(1).collect { schedule(replace = true) }
    }
    if (_index.value.missing().isNotEmpty() || _index.value.missingCovers().isNotEmpty()) schedule(replace = false)
  }

  private fun read(): OfflineIndex =
    runCatching { EchoJson.decodeFromString(OfflineIndex.serializer(), indexFile.readText()) }.getOrDefault(OfflineIndex())

  /** Changes the index (one change at a time) and writes it atomically. */
  private suspend fun change(f: (OfflineIndex) -> OfflineIndex): OfflineIndex =
    lock.withLock {
      val next = f(_index.value)
      _index.value = next
      withContext(Dispatchers.IO) {
        root.mkdirs()
        val tmp = File(root, "index.json.tmp")
        tmp.writeText(EchoJson.encodeToString(OfflineIndex.serializer(), next))
        tmp.renameTo(indexFile)
      }
      next
    }

  // ---- what pages ask ----

  fun status(kind: String, id: String, idx: OfflineIndex = _index.value, now: Fetching? = _fetching.value): ItemStatus {
    val item = idx.item(kind, id) ?: return ItemStatus(DownloadState.None)
    val total = item.tracks.size
    val done = idx.done(item)
    if (done >= total) return ItemStatus(DownloadState.Done, done, total, 1f)
    val partial = now?.takeIf { f -> item.tracks.any { it.id == f.trackId } }
    val progress = ((done + (partial?.fraction ?: 0f)) / total.coerceAtLeast(1)).coerceIn(0f, 1f)
    return ItemStatus(if (partial != null) DownloadState.Downloading else DownloadState.Queued, done, total, progress)
  }

  /** The downloaded file of a track, when it is all there. */
  fun localFile(trackId: String): File? {
    if (trackId !in _index.value.files) return null
    return File(tracksDir, "${safeName(trackId)}.opus").takeIf { it.exists() }
  }

  /** A track's file as a URI for the player, or null. */
  fun localUri(t: Track): String? = if (t.provider != "navidrome") null else localFile(t.id)?.let { Uri.fromFile(it).toString() }

  /** A saved cover for a cover path or URL (any size), as a file URI. */
  fun coverUri(path: String?): String? {
    val id = path?.let(::coverIdOf) ?: return null
    if (id !in _index.value.covers) return null
    return File(coversDir, "${safeName(id)}.jpg").takeIf { it.exists() }?.let { Uri.fromFile(it).toString() }
  }

  /** A downloaded album as the album page shows it (offline). */
  fun album(id: String): Album? =
    _index.value.item("album", id)?.let { Album(it.id, it.title, it.subtitle ?: "", it.artistId, it.year, it.cover, it.tracks) }

  fun playlist(id: String): PlaylistDetail? =
    _index.value.item("playlist", id)?.let {
      PlaylistDetail(Playlist(it.id, it.title, it.tracks.size, it.cover, it.subtitle), it.comment, it.tracks.mapNotNull { t -> t.cover }.distinct().take(4), it.tracks)
    }

  fun liked(): List<Track>? = _index.value.item("liked", "liked")?.tracks

  // ---- what people do ----

  /** Downloads the page's tracks (and covers); says so when the setting makes it wait for Wi-Fi. */
  fun download(item: OfflineItem) {
    if (item.tracks.isEmpty()) return
    app.scope.launch {
      change { it.put(item.copy(addedAt = System.currentTimeMillis())) }
      schedule(replace = false)
      val wifiOnly = app.prefs.state.value.downloadWifiOnly
      app.playback.notify(
        when {
          !app.network.connected.value -> "“${item.title}” will download when you're back online."
          wifiOnly && !app.network.unmetered.value -> "“${item.title}” will download on Wi-Fi. You can change this in Settings."
          else -> "Downloading “${item.title}”"
        },
      )
    }
  }

  fun download(a: Album) =
    download(OfflineItem("album", a.id, a.title, a.artist, a.cover, a.tracks, artistId = a.artistId, year = a.year))

  fun download(p: PlaylistDetail) =
    download(OfflineItem("playlist", p.playlist.id, p.playlist.name, p.playlist.owner, p.playlist.cover ?: p.covers.firstOrNull(), p.entries, comment = p.comment))

  fun downloadLiked(tracks: List<Track>) = download(OfflineItem("liked", "liked", "Liked Songs", null, null, tracks))

  /** Removes the download; files another download still needs stay. */
  fun remove(kind: String, id: String) {
    app.scope.launch {
      var gone: Pair<Set<String>, Set<String>> = emptySet<String>() to emptySet()
      change { idx ->
        val (rest, tracks, covers) = idx.remove("$kind:$id")
        gone = tracks to covers
        rest
      }
      withContext(Dispatchers.IO) {
        for (t in gone.first) File(tracksDir, "${safeName(t)}.opus").delete()
        for (c in gone.second) File(coversDir, "${safeName(c)}.jpg").delete()
      }
    }
  }

  /** Remove all: every file and the list. */
  fun removeAll() {
    androidx.work.WorkManager.getInstance(app).cancelUniqueWork(DownloadWorker.NAME)
    app.scope.launch {
      change { OfflineIndex() }
      withContext(Dispatchers.IO) {
        tracksDir.deleteRecursively()
        coversDir.deleteRecursively()
      }
    }
  }

  /** Signed out: the next account must not get this one's music (REL-05). */
  fun clear() = removeAll()

  /**
   * A downloaded page seen online again with other songs (a playlist changed, a song hearted):
   * the download follows it.
   */
  fun sync(kind: String, id: String, tracks: List<Track>) {
    val old = _index.value.item(kind, id) ?: return
    if (old.tracks.map { it.id } == tracks.map { it.id }) return
    app.scope.launch {
      var dropped: Pair<Set<String>, Set<String>> = emptySet<String>() to emptySet()
      change { idx ->
        val next = idx.put(old.copy(tracks = tracks))
        val tracksGone = next.files.keys - next.wanted
        val coversGone = next.covers.keys - next.wantedCovers
        dropped = tracksGone to coversGone
        next.copy(files = next.files - tracksGone, covers = next.covers - coversGone)
      }
      withContext(Dispatchers.IO) {
        for (t in dropped.first) File(tracksDir, "${safeName(t)}.opus").delete()
        for (c in dropped.second) File(coversDir, "${safeName(c)}.jpg").delete()
      }
      schedule(replace = false)
    }
  }

  private fun schedule(replace: Boolean) = DownloadWorker.schedule(app, app.prefs.state.value.downloadWifiOnly, replace)

  // ---- the worker's side ----

  /**
   * Fetches everything missing, newest download first. Returns false when something failed (the
   * worker retries later); a dropped connection throws [IOException] for the same.
   */
  suspend fun work(onProgress: suspend (done: Int, total: Int) -> Unit): Boolean {
    val failed = HashSet<String>()
    withContext(Dispatchers.IO) {
      tracksDir.mkdirs()
      coversDir.mkdirs()
    }
    // Covers first: small, and the pages look right offline straight away.
    for ((id, path) in _index.value.missingCovers()) {
      currentCoroutineContext().ensureActive()
      val bytes = runCatching { fetchCover(id, path) }.getOrNull()
      if (bytes != null) change { it.copy(covers = it.covers + (id to bytes)) }
    }
    while (true) {
      currentCoroutineContext().ensureActive()
      val idx = _index.value
      val left = idx.missing().filter { it.id !in failed }
      if (left.isEmpty()) break
      val t = left.first()
      val wanted = idx.wanted
      onProgress(wanted.count { it in idx.files }, wanted.size)
      val bytes =
        try {
          fetchTrack(t)
        } catch (e: IOException) {
          _fetching.value = null
          // The connection went: try again later. A refusal for this one track: skip it for now.
          if (!app.network.connected.value || e !is HttpRefused) throw e
          failed += t.id
          null
        }
      _fetching.value = null
      // Removed while it was fetching: the file isn't wanted any more.
      if (bytes != null) {
        if (t.id in _index.value.wanted) change { it.copy(files = it.files + (t.id to bytes)) }
        else withContext(Dispatchers.IO) { File(tracksDir, "${safeName(t.id)}.opus").delete() }
      }
    }
    return failed.isEmpty()
  }

  private class HttpRefused(code: Int) : IOException("HTTP $code")

  private suspend fun fetchTrack(t: Track): Long =
    withContext(Dispatchers.IO) {
      val url = app.api.url("/api/v1/navidrome/stream/${URLEncoder.encode(t.id, "UTF-8")}?$OFFLINE_FORMAT")
      val dest = File(tracksDir, "${safeName(t.id)}.opus")
      val part = File(tracksDir, "${safeName(t.id)}.part")
      _fetching.value = Fetching(t.id, 0f)
      app.api.http.newCall(Request.Builder().url(url).build()).execute().use { res ->
        val type = res.header("content-type").orEmpty()
        if (!res.isSuccessful || type.contains("json")) throw HttpRefused(res.code)
        val body = res.body
        val length = body.contentLength()
        var got = 0L
        var shown = 0f
        part.outputStream().use { out ->
          body.byteStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
              ensureActive()
              val n = input.read(buf)
              if (n < 0) break
              out.write(buf, 0, n)
              got += n
              // Navidrome rarely knows a transcode's length; the bar moves per song then.
              if (length > 0) {
                val f = (got.toFloat() / length).coerceIn(0f, 1f)
                if (f - shown >= 0.04f) {
                  shown = f
                  _fetching.value = Fetching(t.id, f)
                }
              }
            }
          }
        }
        if (got == 0L) throw HttpRefused(res.code)
        if (!part.renameTo(dest)) throw IOException("rename")
        got
      }
    }

  private suspend fun fetchCover(id: String, path: String): Long =
    withContext(Dispatchers.IO) {
      val url = app.api.url(path.replace(Regex("size=\\d+"), "size=600"))
      val dest = File(coversDir, "${safeName(id)}.jpg")
      app.api.http.newCall(Request.Builder().url(url).build()).execute().use { res ->
        if (!res.isSuccessful) throw HttpRefused(res.code)
        val bytes = res.body.bytes()
        dest.writeBytes(bytes)
        bytes.size.toLong()
      }
    }
}
