package com.folk3s.echo.playback

import com.folk3s.echo.api.Album
import com.folk3s.echo.api.Mix
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.Playlist
import com.folk3s.echo.api.Track
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap

// The browse tree Android Auto (and any other media browser) sees, as plain data: what the
// library session in PlaybackService turns into MediaItems. Pure Kotlin, so it is unit tested
// (CarTreeTest). No lyrics, no Stage: only what is safe to look at while driving.

/** The root's shelves, in the order the car shows them. */
enum class CarShelf(val key: String, val title: String) {
  Recent("recent", "Recently played"),
  Mixes("mixes", "Made for you"),
  Playlists("playlists", "Playlists"),
  Albums("albums", "New albums"),
  Liked("liked", "Liked songs"),
}

/**
 * A browse node's id. Every part is URL-encoded and the parts are joined by `/`, so any album,
 * playlist or mix id (and any search) round-trips through [format] and [parse].
 */
sealed interface CarId {
  data object Root : CarId

  /** The shelves that do not fit on a car whose root shows fewer (Android Auto: 4 tabs). */
  data object More : CarId

  data class Shelf(val shelf: CarShelf) : CarId

  data class Album(val id: String) : CarId

  data class Playlist(val id: String) : CarId

  data class Mix(val id: String) : CarId

  data class Search(val query: String) : CarId

  /** A song as one of a list's: playing it plays the list from there. */
  data class Song(val parent: CarId, val trackId: String) : CarId

  fun format(): String =
    when (this) {
      Root -> ROOT
      More -> MORE
      is Shelf -> "shelf/${shelf.key}"
      is Album -> "album/${enc(id)}"
      is Playlist -> "playlist/${enc(id)}"
      is Mix -> "mix/${enc(id)}"
      is Search -> "search/${enc(query)}"
      is Song -> "song/${enc(trackId)}/${enc(parent.format())}"
    }

  /** Whether this node lists songs (and so can be played from), rather than other nodes. */
  val holdsSongs: Boolean
    get() = this is Album || this is Playlist || this is Mix || this is Search || this == Shelf(CarShelf.Liked)

  companion object {
    const val ROOT = "root"
    const val MORE = "more"

    fun parse(s: String): CarId? {
      if (s == ROOT) return Root
      if (s == MORE) return More
      val parts = s.split('/', limit = 3)
      if (parts.size < 2) return null
      val a = runCatching { dec(parts[1]) }.getOrNull() ?: return null
      return when (parts[0]) {
        "shelf" -> CarShelf.entries.firstOrNull { it.key == parts[1] }?.let { Shelf(it) }
        "album" -> Album(a)
        "playlist" -> Playlist(a)
        "mix" -> Mix(a)
        "search" -> Search(a)
        "song" -> {
          if (parts.size < 3) return null
          val parent = runCatching { dec(parts[2]) }.getOrNull()?.let(::parse) ?: return null
          if (!parent.holdsSongs) null else Song(parent, a)
        }
        else -> null
      }?.takeIf { a.isNotEmpty() || it is Search }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun dec(s: String) = URLDecoder.decode(s, "UTF-8")
  }
}

enum class CarKind { Folder, Album, Playlist, Mix, Song }

/** One row of the car's lists: a folder to open or a song to play. */
data class CarNode(
  val id: String,
  val title: String,
  val subtitle: String? = null,
  /** A server path or URL (a cover), or null. */
  val art: String? = null,
  val kind: CarKind,
  val durationMs: Long? = null,
  /** The song this row plays (songs only). */
  val track: Track? = null,
) {
  val playable: Boolean get() = kind == CarKind.Song
  val browsable: Boolean get() = !playable
}

object CarTree {
  /** How many albums the "New albums" and "Recently played" shelves list. */
  const val ALBUMS = 40

  private fun shelf(s: CarShelf) = CarNode(CarId.Shelf(s).format(), s.title, kind = CarKind.Folder)

  /**
   * The root's rows. A browser that shows at most [limit] (Android Auto's root hint, its tabs) gets
   * the first shelves and a "More" folder with the rest; 0 means no limit.
   */
  fun root(limit: Int = 0): List<CarNode> {
    val all = CarShelf.entries
    if (limit <= 0 || limit >= all.size) return all.map(::shelf)
    if (limit == 1) return listOf(CarNode(CarId.More.format(), "Library", kind = CarKind.Folder))
    return all.take(limit - 1).map(::shelf) + CarNode(CarId.More.format(), "More", kind = CarKind.Folder)
  }

  /** What "More" holds for the same limit. */
  fun more(limit: Int): List<CarNode> {
    val all = CarShelf.entries
    if (limit <= 0 || limit >= all.size) return emptyList()
    return all.drop(if (limit == 1) 0 else limit - 1).map(::shelf)
  }

  fun albums(list: List<Album>): List<CarNode> =
    list.map { CarNode(CarId.Album(it.id).format(), it.title, it.artist.takeIf { a -> a.isNotBlank() }, it.cover, CarKind.Album) }

  fun playlists(list: List<Playlist>): List<CarNode> =
    list.map { CarNode(CarId.Playlist(it.id).format(), it.name, "${it.tracks} songs", it.cover, CarKind.Playlist) }

  fun mixes(list: List<Mix>): List<CarNode> =
    list.filter { it.tracks.isNotEmpty() }.map { m ->
      CarNode(CarId.Mix(m.id).format(), m.title, m.subtitle.takeIf { it.isNotBlank() }, m.tracks.firstNotNullOfOrNull { it.cover }, CarKind.Mix)
    }

  /** A list's songs; each one's id says which list it is in, so playing it plays the list. */
  fun songs(parent: CarId, tracks: List<Track>): List<CarNode> =
    tracks.map { t -> CarNode(CarId.Song(parent, t.id).format(), t.title, t.artist.takeIf { it.isNotBlank() }, t.cover, CarKind.Song, t.durationMs.takeIf { it > 0 }, t) }

  /** Where a song is in its list: by id, the first of repeats; 0 when it has gone. */
  fun startIndex(tracks: List<Track>, trackId: String): Int = tracks.indexOfFirst { it.id == trackId }.coerceAtLeast(0)

  /** One page of a list (Media3 pages from 0); everything when the browser asks for no paging. */
  fun <T> page(list: List<T>, page: Int, pageSize: Int): List<T> {
    if (pageSize <= 0 || pageSize == Int.MAX_VALUE) return if (page <= 0) list else emptyList()
    val from = page.toLong() * pageSize
    if (page < 0 || from >= list.size) return emptyList()
    return list.subList(from.toInt(), minOf(list.size.toLong(), from + pageSize).toInt())
  }

  /** What the play history and the in-app queue call a list played from the car. */
  fun contextOf(id: CarId, title: String): PlayContext? =
    when (id) {
      is CarId.Album -> PlayContext("album", id.id, title)
      is CarId.Playlist -> PlayContext("playlist", id.id, title)
      is CarId.Mix -> PlayContext("mix", id.id, title)
      is CarId.Search -> PlayContext("search", title = "“${id.query.trim()}”")
      CarId.Shelf(CarShelf.Liked) -> PlayContext("starred", title = "Liked Songs")
      else -> null
    }

  /** The stream path the app plays a song from (Playback's item()): the original file, untouched. */
  fun streamPath(trackId: String) = "/api/v1/navidrome/stream/${URLEncoder.encode(trackId, "UTF-8")}?format=raw"

  /** Covers through ECHO's server, which the artwork provider may fetch with the device token. */
  const val COVER_PREFIX = "/api/v1/navidrome/cover/"
}

/**
 * Songs the library session put in the player itself (from the car), by their key, so the in-app
 * player can show them: the app keeps its own tracks for what it queued.
 */
object KnownTracks {
  private val map = ConcurrentHashMap<String, Track>()

  fun put(t: Track) {
    map[t.key] = t
  }

  operator fun get(key: String): Track? = map[key]

  fun clear() = map.clear()
}
