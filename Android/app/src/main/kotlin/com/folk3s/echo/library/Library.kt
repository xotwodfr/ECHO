package com.folk3s.echo.library

import com.folk3s.echo.api.Album
import com.folk3s.echo.api.AlbumRef
import com.folk3s.echo.api.Api
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.api.ArtistRef
import com.folk3s.echo.api.Artwork
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.Playlist
import com.folk3s.echo.api.ReplayGain
import com.folk3s.echo.api.Track
import java.net.URLEncoder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement

// The signed-in user's Navidrome library through ECHO's proxy (src/client/library-navidrome.ts):
// the album list up front (getAlbumList2, paged), an album's tracks when it is opened or played
// (getAlbum), the rest on demand.

enum class AlbumSort(val api: String, val label: String) {
  Newest("newest", "Recently added"),
  AZ("alphabeticalByName", "A–Z"),
  Year("byYear", "Year"),
  Frequent("frequent", "Most played"),
}

enum class Status { Loading, Ready, Error, NotConnected }

data class ArtistPage(val name: String, val albums: List<Album>)

data class SearchResult(val tracks: List<Track>, val albums: List<Album>)

@Serializable
private data class SubSong(
  val id: String,
  val title: String,
  val artist: String? = null,
  val artistId: String? = null,
  val album: String? = null,
  val albumId: String? = null,
  val coverArt: String? = null,
  val duration: Long? = null,
  val contentType: String? = null,
  val isrc: JsonElement? = null, // a string, or an array of them (OpenSubsonic)
  val replayGain: ReplayGain? = null,
)

@Serializable
private data class SubAlbum(
  val id: String,
  val name: String,
  val artist: String? = null,
  val artistId: String? = null,
  val year: Int? = null,
  val coverArt: String? = null,
  val song: List<SubSong>? = null,
)

private const val PAGE = 500

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

private fun cover(id: String?, size: Int = 300) = id?.let { "/api/v1/navidrome/cover/${enc(it)}?size=$size" }

private fun trackOf(s: SubSong, a: SubAlbum): Track {
  val art = cover(s.coverArt ?: a.coverArt, 600)
  val isrc =
    when (val i = s.isrc) {
      is JsonArray -> i.firstOrNull()?.jsonPrimitive?.contentOrNull
      is JsonPrimitive -> i.contentOrNull
      else -> null
    }
  return Track(
    key = "navidrome:${s.id}",
    id = s.id,
    title = s.title,
    artists = listOf(ArtistRef(s.artistId, s.artist ?: a.artist ?: "")),
    album = AlbumRef(a.id, s.album ?: a.name, "navidrome:${a.id}"),
    durationMs = (s.duration ?: 0) * 1000,
    artwork = art?.let { listOf(Artwork(it)) } ?: emptyList(),
    isrc = isrc,
    replayGain = s.replayGain,
    contentType = s.contentType,
  )
}

private fun albumOf(a: SubAlbum) =
  Album(a.id, a.name, a.artist ?: "", a.artistId, a.year, cover(a.coverArt), (a.song ?: emptyList()).map { trackOf(it, a) })

private fun songs(list: List<SubSong>?) =
  (list ?: emptyList()).map { trackOf(it, SubAlbum(it.albumId ?: "", it.album ?: "", coverArt = it.coverArt)) }

class Library(private val api: Api, private val scope: CoroutineScope) {
  private val _albums = MutableStateFlow<List<Album>>(emptyList())
  val albums: StateFlow<List<Album>> = _albums
  private val _status = MutableStateFlow(Status.Loading)
  val status: StateFlow<Status> = _status
  private val _sort = MutableStateFlow(AlbumSort.Newest)
  val sort: StateFlow<AlbumSort> = _sort

  private val byId = mutableMapOf<String, Album>()
  private val loaded = mutableSetOf<String>()
  private var job: Job? = null

  /**
   * A Subsonic call through ECHO's proxy. Navidrome refuses with HTTP 200 and `status: "failed"`:
   * that is an error here (`subsonic.<code>`), never an empty answer.
   */
  private suspend fun rest(method: String, query: String = ""): JsonObject {
    val r = api.get("/navidrome/rest/$method${if (query.isEmpty()) "" else "?$query"}").jsonObject
    val sr = r["subsonic-response"]!!.jsonObject
    if (sr["status"]?.jsonPrimitive?.contentOrNull == "failed") {
      val code = sr["error"]?.jsonObject?.get("code")?.jsonPrimitive?.intOrNull ?: 0
      throw ApiError(200, "subsonic.$code")
    }
    return sr
  }

  private inline fun <reified T> JsonObject.at(vararg path: String): T? {
    var e: JsonElement = this
    for (p in path) e = (e as? JsonObject)?.get(p) ?: return null
    return EchoJson.decodeFromJsonElement<T>(e)
  }

  /** The whole album list in the chosen order, page by page; a newer sort supersedes it. */
  fun reload() {
    job?.cancel()
    _status.value = Status.Loading
    job =
      scope.launch {
        val next = mutableListOf<Album>()
        var offset = 0
        while (true) {
          val year = if (_sort.value == AlbumSort.Year) "&fromYear=9999&toYear=0" else ""
          val page =
            try {
              rest("getAlbumList2", "type=${_sort.value.api}&size=$PAGE&offset=$offset$year")
                .at<List<SubAlbum>>("albumList2", "album") ?: emptyList()
            } catch (e: ApiError) {
              _status.value =
                when {
                  e.status == 409 -> Status.NotConnected
                  _albums.value.isNotEmpty() -> Status.Ready
                  else -> Status.Error
                }
              return@launch
            } catch (e: java.io.IOException) {
              _status.value = if (_albums.value.isNotEmpty()) Status.Ready else Status.Error
              return@launch
            }
          for (a in page) {
            val known = byId[a.id]
            val album = if (known != null && a.id in loaded) known else albumOf(a)
            byId[a.id] = album
            next += album
          }
          _albums.value = next.toList()
          _status.value = Status.Ready
          if (page.size < PAGE) break
          offset += PAGE
        }
      }
  }

  fun setSort(s: AlbumSort) {
    if (s == _sort.value) return
    _sort.value = s
    reload()
  }

  fun album(id: String): Album? = byId[id]

  /** Not found (Subsonic 70) is an answer: null. Anything else throws, for Retry. */
  suspend fun loadAlbum(id: String): Album? {
    if (id in loaded) return byId[id]
    val a =
      try {
        rest("getAlbum", "id=${enc(id)}").at<SubAlbum>("album")
      } catch (e: ApiError) {
        if (e.code == "subsonic.70") return null else throw e
      } ?: return byId[id]
    val album = albumOf(a)
    loaded += id
    byId[id] = album
    _albums.value = if (_albums.value.any { it.id == id }) _albums.value.map { if (it.id == id) album else it } else _albums.value + album
    return album
  }

  suspend fun artist(id: String): ArtistPage? {
    val a =
      try {
        rest("getArtist", "id=${enc(id)}")["artist"]?.jsonObject
      } catch (e: ApiError) {
        if (e.code == "subsonic.70") return null else throw e
      } ?: return null
    val albums =
      (a.at<List<SubAlbum>>("album") ?: emptyList()).map { x ->
        byId[x.id] ?: albumOf(x).also { byId[x.id] = it }
      }
    return ArtistPage(a["name"]?.jsonPrimitive?.contentOrNull ?: "", albums)
  }

  suspend fun playlists(): List<Playlist> =
    (rest("getPlaylists").at<List<JsonObject>>("playlists", "playlist") ?: emptyList()).map {
      Playlist(
        it["id"]!!.jsonPrimitive.content,
        it["name"]?.jsonPrimitive?.contentOrNull ?: "",
        it["songCount"]?.jsonPrimitive?.intOrNull ?: 0,
      )
    }

  suspend fun playlistTracks(id: String): List<Track> = songs(rest("getPlaylist", "id=${enc(id)}").at("playlist", "entry"))

  suspend fun starred(): List<Track> = songs(rest("getStarred2").at("starred2", "song"))

  /** What is loaded, filtered: titles, artists and album names. */
  fun search(q: String): SearchResult {
    val needle = q.trim().lowercase()
    if (needle.isEmpty()) return SearchResult(emptyList(), emptyList())
    fun hit(vararg t: String) = t.any { it.lowercase().contains(needle) }
    val albums = _albums.value
    return SearchResult(
      albums.flatMap { it.tracks }.filter { t -> hit(t.title, *t.artists.map { it.name }.toTypedArray()) },
      albums.filter { hit(it.title, it.artist) },
    )
  }

  suspend fun searchRemote(q: String): SearchResult {
    val r = rest("search3", "query=${enc(q)}&artistCount=6&albumCount=6&songCount=6")
    return SearchResult(songs(r.at("searchResult3", "song")), (r.at<List<SubAlbum>>("searchResult3", "album") ?: emptyList()).map(::albumOf))
  }

  /** Signed out or another account: nothing of the last one stays. */
  fun clear() {
    job?.cancel()
    byId.clear()
    loaded.clear()
    _albums.value = emptyList()
    _status.value = Status.Loading
  }
}
