package com.folk3s.echo.offline

import com.folk3s.echo.api.Track
import java.net.URLDecoder
import kotlinx.serialization.Serializable

// What is downloaded (v0.8, docs/ANDROID_CLIENT.md): albums, playlists and Liked Songs with the
// tracks and covers they need to show and play with no connection. Pure, for OfflineTest: the
// files themselves are [Downloads]'s.

/** The stream a download is made from: Opus at 192 kbps, transcoded by Navidrome (owner, 2026-11-19). */
const val OFFLINE_FORMAT = "format=opus&maxBitRate=192"

/** One downloaded album, playlist or Liked Songs, as it was when last seen online. */
@Serializable
data class OfflineItem(
  /** "album", "playlist" or "liked" (the play contexts' kinds; Liked Songs is "starred" there). */
  val kind: String,
  val id: String,
  val title: String,
  /** The album's artist or the playlist's owner. */
  val subtitle: String? = null,
  /** A server cover path (`/api/v1/navidrome/cover/…`), served from the saved file offline. */
  val cover: String? = null,
  val tracks: List<Track> = emptyList(),
  val addedAt: Long = 0,
  val artistId: String? = null,
  val year: Int? = null,
  val comment: String? = null,
) {
  val key: String get() = "$kind:$id"
}

/** Everything downloaded: the items, and the finished files (track id → bytes, cover id → bytes). */
@Serializable
data class OfflineIndex(
  val items: List<OfflineItem> = emptyList(),
  val files: Map<String, Long> = emptyMap(),
  val covers: Map<String, Long> = emptyMap(),
) {
  fun item(kind: String, id: String): OfflineItem? = items.firstOrNull { it.kind == kind && it.id == id }

  /** Adds the item, or replaces the one with its key (keeping when it was first added). */
  fun put(item: OfflineItem): OfflineIndex {
    val old = items.firstOrNull { it.key == item.key }
    val next = if (old != null) item.copy(addedAt = old.addedAt) else item
    return copy(items = if (old != null) items.map { if (it.key == item.key) next else it } else listOf(next) + items)
  }

  /** Track ids some item still needs. */
  val wanted: Set<String> get() = items.flatMapTo(HashSet()) { i -> i.tracks.map { it.id } }

  /** Cover ids some item still shows. */
  val wantedCovers: Set<String> get() = items.flatMapTo(HashSet()) { coversOf(it) }

  /**
   * The item gone, with the track files and covers no other item needs (to delete). A track in
   * two playlists stays until both are removed.
   */
  fun remove(key: String): Triple<OfflineIndex, Set<String>, Set<String>> {
    val rest = copy(items = items.filter { it.key != key })
    val tracks = files.keys - rest.wanted
    val covers = covers.keys - rest.wantedCovers
    return Triple(rest.copy(files = files - tracks, covers = this.covers - covers), tracks, covers)
  }

  /** The tracks still to fetch, in the order they were asked for (newest item first), each once. */
  fun missing(): List<Track> = items.flatMap { it.tracks }.filter { it.id !in files }.distinctBy { it.id }

  /** Covers still to fetch: one server path per cover id. */
  fun missingCovers(): List<Pair<String, String>> =
    items.flatMap { i -> listOfNotNull(i.cover) + i.tracks.mapNotNull { it.cover } }
      .mapNotNull { p -> coverIdOf(p)?.let { it to p } }
      .distinctBy { it.first }
      .filter { it.first !in covers }

  /** How many of the item's tracks are on the phone. */
  fun done(item: OfflineItem): Int = item.tracks.count { it.id in files }

  fun complete(item: OfflineItem): Boolean = item.tracks.all { it.id in files }

  /** The item's share of the storage: its tracks' files (a shared track counts for each). */
  fun bytes(item: OfflineItem): Long = item.tracks.distinctBy { it.id }.sumOf { files[it.id] ?: 0L }

  /** All of it: every track file once, and the covers. */
  val totalBytes: Long get() = files.values.sum() + covers.values.sum()
}

/** The cover ids an item shows: its own cover's and its tracks'. */
fun coversOf(i: OfflineItem): Set<String> =
  (listOfNotNull(i.cover) + i.tracks.mapNotNull { it.cover }).mapNotNullTo(HashSet()) { coverIdOf(it) }

private val COVER = Regex("/navidrome/cover/([^?#]+)")

/** The cover id in a cover path or URL, whatever size it asks for; null for anything else. */
fun coverIdOf(path: String): String? = COVER.find(path)?.groupValues?.get(1)?.let { URLDecoder.decode(it, "UTF-8") }

/** A file name for an id: its safe characters, plus a hash when any were changed (no clashes). */
fun safeName(id: String): String {
  val clean = id.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
  return if (clean == id) id else "$clean-${Integer.toHexString(id.hashCode())}"
}

/**
 * What a queued track plays from. The karaoke version wins while Karaoke mode is on, the server
 * has one and the server can be reached; otherwise the downloaded file when there is one (no data
 * used); otherwise the stream (the karaoke version still, if on and ready: offline neither plays).
 */
fun chooseSource(stream: String, karaoke: String?, karaokeOn: Boolean, local: String?, online: Boolean): String =
  if (karaokeOn && karaoke != null && (online || local == null)) karaoke else local ?: stream

/** Sizes as people read them: 840 KB, 12.4 MB, 1.2 GB. */
fun formatBytes(b: Long): String =
  when {
    b >= 1_000_000_000 -> "%.1f GB".format(b / 1e9)
    b >= 10_000_000 -> "%d MB".format(b / 1_000_000)
    b >= 1_000_000 -> "%.1f MB".format(b / 1e6)
    b >= 1_000 -> "%d KB".format(b / 1_000)
    else -> "$b B"
  }
