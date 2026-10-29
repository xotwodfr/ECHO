package com.folk3s.echo.library

import com.folk3s.echo.api.Album
import com.folk3s.echo.api.AlbumRef
import com.folk3s.echo.api.Api
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.api.ArtistCard
import com.folk3s.echo.api.ArtistInfo
import com.folk3s.echo.api.ArtistRef
import com.folk3s.echo.api.Artwork
import com.folk3s.echo.api.Genre
import com.folk3s.echo.api.Mix
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.PlayedContext
import com.folk3s.echo.api.Wrapped
import com.folk3s.echo.api.PlaylistDetail
import com.folk3s.echo.api.Starred
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.Playlist
import com.folk3s.echo.api.ReplayGain
import com.folk3s.echo.api.Track
import java.net.URLEncoder
import java.util.TimeZone
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
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
import kotlinx.serialization.json.encodeToJsonElement

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

data class SearchResult(val tracks: List<Track>, val albums: List<Album>, val artists: List<ArtistCard> = emptyList())

/** Home's shelves (getAlbumList2's kinds). */
enum class AlbumList(val api: String) { Recent("recent"), Newest("newest"), Frequent("frequent"), Random("random") }

enum class StarKind(val param: String) { Track("id"), Album("albumId"), Artist("artistId") }

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

/** `POST /me/plays`'s body. The provider is a default, which EchoJson leaves out; the server wants it said. */
fun playBody(t: Track, ctx: PlayContext?): JsonObject =
  JsonObject(
    buildMap {
      put("track", JsonObject(EchoJson.encodeToJsonElement(t).jsonObject + ("provider" to JsonPrimitive(t.provider))))
      if (ctx != null) put("context", EchoJson.encodeToJsonElement(ctx))
    },
  )

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

@Serializable
private data class SubArtist(val id: String, val name: String, val coverArt: String? = null)

private fun artistOf(a: SubArtist) = ArtistCard(a.id, a.name, cover(a.coverArt ?: "ar-${a.id}"))

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
        cover(it["coverArt"]?.jsonPrimitive?.contentOrNull),
        it["owner"]?.jsonPrimitive?.contentOrNull,
      )
    }

  suspend fun playlistTracks(id: String): List<Track> = songs(rest("getPlaylist", "id=${enc(id)}").at("playlist", "entry"))

  suspend fun starred(): List<Track> = songs(rest("getStarred2").at("starred2", "song"))

  // ---- The Spotify-style pages (docs/superpowers/specs/2026-10-29-spotify-redesign-design.md) ----

  private val _playlists = MutableStateFlow<List<Playlist>?>(null)
  /** The user's playlists, for Your Library and Add to playlist; null until loaded. */
  val playlistsFlow: StateFlow<List<Playlist>?> = _playlists
  private val _starred = MutableStateFlow<Starred?>(null)
  /** Everything hearted, for the hearts and Liked Songs; null until loaded. */
  val starredFlow: StateFlow<Starred?> = _starred

  fun refreshCollections() {
    scope.launch { runCatching { playlists() }.onSuccess { _playlists.value = it } }
    scope.launch { runCatching { starredAll() }.onSuccess { _starred.value = it } }
  }

  private suspend fun write(method: String, params: List<Pair<String, String>>) {
    val q = params.joinToString("&") { (k, v) -> "$k=${enc(v)}" }
    val r = api.send("POST", "/navidrome/rest/$method?$q").jsonObject["subsonic-response"]!!.jsonObject
    if (r["status"]?.jsonPrimitive?.contentOrNull == "failed") {
      val code = r["error"]?.jsonObject?.get("code")?.jsonPrimitive?.intOrNull ?: 0
      throw ApiError(200, "subsonic.$code")
    }
  }

  suspend fun albumList(kind: AlbumList, size: Int): List<Album> =
    (rest("getAlbumList2", "type=${kind.api}&size=$size").at<List<SubAlbum>>("albumList2", "album") ?: emptyList()).map { x ->
      byId[x.id] ?: albumOf(x).also { byId[x.id] = it }
    }

  suspend fun starredAll(): Starred {
    val r = rest("getStarred2")
    return Starred(
      songs(r.at("starred2", "song")),
      (r.at<List<SubAlbum>>("starred2", "album") ?: emptyList()).map(::albumOf),
      (r.at<List<SubArtist>>("starred2", "artist") ?: emptyList()).map(::artistOf),
    )
  }

  /** Heart or un-heart: at once here, back again if the server refuses. */
  suspend fun setStar(kind: StarKind, id: String, on: Boolean, track: Track? = null, album: Album? = null) {
    val before = _starred.value ?: Starred()
    _starred.value =
      when (kind) {
        StarKind.Track -> before.copy(tracks = if (on && track != null) listOf(track) + before.tracks.filter { it.id != id } else before.tracks.filter { it.id != id })
        StarKind.Album -> before.copy(albums = if (on && album != null) listOf(album) + before.albums.filter { it.id != id } else before.albums.filter { it.id != id })
        StarKind.Artist -> before.copy(artists = before.artists.filter { it.id != id })
      }
    try {
      write(if (on) "star" else "unstar", listOf(kind.param to id))
      if (kind == StarKind.Artist) _starred.value = starredAll()
    } catch (e: Exception) {
      _starred.value = before
      throw e
    }
  }

  suspend fun playlist(id: String): PlaylistDetail? {
    val p =
      try {
        rest("getPlaylist", "id=${enc(id)}")["playlist"]?.jsonObject
      } catch (e: ApiError) {
        if (e.code == "subsonic.70") return null else throw e
      } ?: return null
    val entries = songs(p.at("entry"))
    return PlaylistDetail(
      Playlist(id, p["name"]?.jsonPrimitive?.contentOrNull ?: "", entries.size, cover(p["coverArt"]?.jsonPrimitive?.contentOrNull), p["owner"]?.jsonPrimitive?.contentOrNull),
      p["comment"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() },
      entries.mapNotNull { it.cover }.distinct().take(4),
      entries,
    )
  }

  suspend fun createPlaylist(name: String, trackIds: List<String> = emptyList()): String {
    val q = (listOf("name" to name) + trackIds.map { "songId" to it }).joinToString("&") { (k, v) -> "$k=${enc(v)}" }
    val r = api.send("POST", "/navidrome/rest/createPlaylist?$q").jsonObject["subsonic-response"]!!.jsonObject
    _playlists.value = playlists()
    return r["playlist"]?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull ?: ""
  }

  suspend fun updatePlaylist(id: String, name: String? = null, comment: String? = null, add: List<String> = emptyList(), remove: List<Int> = emptyList()) {
    write(
      "updatePlaylist",
      listOf("playlistId" to id) +
        listOfNotNull(name?.let { "name" to it }, comment?.let { "comment" to it }) +
        add.map { "songIdToAdd" to it } +
        remove.map { "songIndexToRemove" to it.toString() },
    )
    _playlists.value = playlists()
  }

  suspend fun deletePlaylist(id: String) {
    write("deletePlaylist", listOf("id" to id))
    _playlists.value = playlists()
  }

  suspend fun artistInfo(id: String): ArtistInfo {
    val r = rest("getArtistInfo2", "id=${enc(id)}&count=12")["artistInfo2"]?.jsonObject
    // Last.fm's biography ends in a "Read more on Last.fm" link: text only here.
    val bio =
      r?.get("biography")?.jsonPrimitive?.contentOrNull
        ?.replace(Regex("<[^>]*>"), "")?.replace(Regex("\\s*Read more on Last\\.fm\\.?\\s*$"), "")?.trim()
        ?.takeIf { it.isNotBlank() }
    val similar = (r?.at<List<SubArtist>>("similarArtist") ?: emptyList()).filter { it.id.isNotBlank() }.map(::artistOf)
    return ArtistInfo(bio, cover("ar-$id", 600), similar)
  }

  suspend fun topSongs(artist: String, count: Int): List<Track> =
    songs(rest("getTopSongs", "artist=${enc(artist)}&count=$count").at("topSongs", "song"))

  /** Song radio: Navidrome's similar songs (Last.fm), or random ones without them. */
  suspend fun similarSongs(t: Track, count: Int): List<Track> {
    val similar = runCatching { songs(rest("getSimilarSongs2", "id=${enc(t.id)}&count=$count").at("similarSongs2", "song")) }.getOrDefault(emptyList())
    if (similar.isNotEmpty()) return similar
    return songs(rest("getRandomSongs", "size=$count").at("randomSongs", "song")).filter { it.id != t.id }
  }

  /**
   * Smart Shuffle (radio.ts's): the list shuffled with songs like a few of its own mixed in, one
   * after every three; with how many were mixed in.
   */
  suspend fun smartShuffle(tracks: List<Track>): Pair<List<Track>, Int> = coroutineScope {
    val order = tracks.shuffled()
    val own = tracks.map { it.id }.toSet()
    val recs =
      order.take(4).map { async { runCatching { similarSongs(it, 10) }.getOrDefault(emptyList()) } }.awaitAll()
        .flatten().distinctBy { it.id }.filter { it.id !in own }
    var r = 0
    val out = buildList {
      order.forEachIndexed { i, t ->
        add(t)
        if (i % 3 == 2 && r < recs.size) add(recs[r++])
      }
    }
    out to r
  }

  // ---- ECHO's own history (src/server/plays.ts) ----

  /** A play past the scrobble point, with what it was played from. */
  suspend fun recordPlay(t: Track, ctx: PlayContext?) {
    api.send("POST", "/me/plays", playBody(t, ctx))
  }

  /** Made For You; the daylist follows the device's time of day (getTimezoneOffset's sign). */
  suspend fun mixes(): List<Mix> {
    val tz = -TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
    return EchoJson.decodeFromJsonElement(api.get("/me/mixes?tz=$tz").jsonObject["mixes"] ?: JsonArray(emptyList()))
  }

  suspend fun playedContexts(): List<PlayedContext> =
    EchoJson.decodeFromJsonElement(api.get("/me/plays/contexts").jsonObject["contexts"] ?: JsonArray(emptyList()))

  suspend fun wrapped(year: Int): Wrapped = EchoJson.decodeFromJsonElement(api.get("/me/wrapped?year=$year"))

  suspend fun genres(): List<Genre> =
    (rest("getGenres").at<List<JsonObject>>("genres", "genre") ?: emptyList())
      .map { Genre(it["value"]?.jsonPrimitive?.contentOrNull ?: "", it["albumCount"]?.jsonPrimitive?.intOrNull ?: 0) }
      .filter { it.name.isNotBlank() && it.albums > 0 }
      .sortedByDescending { it.albums }

  suspend fun genreAlbums(genre: String): List<Album> =
    (rest("getAlbumList2", "type=byGenre&genre=${enc(genre)}&size=500").at<List<SubAlbum>>("albumList2", "album") ?: emptyList()).map { x ->
      byId[x.id] ?: albumOf(x).also { byId[x.id] = it }
    }

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
    return SearchResult(
      songs(r.at("searchResult3", "song")),
      (r.at<List<SubAlbum>>("searchResult3", "album") ?: emptyList()).map(::albumOf),
      (r.at<List<SubArtist>>("searchResult3", "artist") ?: emptyList()).map(::artistOf),
    )
  }

  /** Signed out or another account: nothing of the last one stays. */
  fun clear() {
    job?.cancel()
    _playlists.value = null
    _starred.value = null
    byId.clear()
    loaded.clear()
    _albums.value = emptyList()
    _status.value = Status.Loading
  }
}
