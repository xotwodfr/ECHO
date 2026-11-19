package com.folk3s.echo.playback

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.Track
import com.folk3s.echo.library.AlbumList
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

private const val SEARCH_SUPPORTED = "android.media.browse.SEARCH_SUPPORTED"
private const val CACHE_MS = 5 * 60_000L

/**
 * The library session's callback (PlaybackService): the browse tree ([CarTree]) over the user's
 * library, search, and turning what a browser asks to play into playable items. The app's own
 * MediaController sends full items (with their stream URIs); those pass straight through.
 */
@OptIn(UnstableApi::class)
class CarLibrary(private val app: EchoApp, private val scope: CoroutineScope) : MediaLibrarySession.Callback {
  /** A list's songs and title, briefly, so playing a song does not fetch its list again. */
  private data class Songs(val title: String, val tracks: List<Track>, val at: Long = System.currentTimeMillis())

  private val songs = HashMap<String, Songs>()
  private val searches = HashMap<String, Pair<Long, List<CarNode>>>()
  /** Each browser's root limit (its tabs), from its root request. */
  private val limits = HashMap<String, Int>()

  // ---- browsing ----

  override fun onGetLibraryRoot(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> {
    // The system's "recent" root (resumption cards) is Media3's onPlaybackResumption's job.
    if (params?.isRecent == true) return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_NOT_SUPPORTED))
    limits[browser.packageName] = params?.extras?.getInt(MediaConstants.EXTRAS_KEY_ROOT_CHILDREN_LIMIT, 0) ?: 0
    val extras =
      Bundle().apply {
        putBoolean(SEARCH_SUPPORTED, true)
        putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM)
        putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM)
      }
    val root = folder(CarId.ROOT, "ECHO", MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
    return Futures.immediateFuture(LibraryResult.ofItem(root, LibraryParams.Builder().setExtras(extras).build()))
  }

  override fun onGetChildren(
    session: MediaLibrarySession,
    browser: MediaSession.ControllerInfo,
    parentId: String,
    page: Int,
    pageSize: Int,
    params: LibraryParams?,
  ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val id = CarId.parse(parentId) ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
    val limit = limits[browser.packageName] ?: 0
    return library {
      val nodes = children(id, limit) ?: return@library LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
      LibraryResult.ofItemList(CarTree.page(nodes, page, pageSize).map(::browseItem), null)
    }
  }

  override fun onGetItem(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> {
    val id = CarId.parse(mediaId) ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
    return library {
      when (id) {
        is CarId.Song -> {
          val t = load(id.parent)?.tracks?.firstOrNull { it.id == id.trackId } ?: return@library LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
          LibraryResult.ofItem(browseItem(CarTree.songs(id.parent, listOf(t)).first()), null)
        }
        CarId.Root -> LibraryResult.ofItem(folder(CarId.ROOT, "ECHO", MediaMetadata.MEDIA_TYPE_FOLDER_MIXED), null)
        else -> {
          // A folder: its title, as its list (or its shelf) knows it.
          val node = CarTree.root().firstOrNull { it.id == mediaId } ?: load(id)?.let { CarNode(mediaId, it.title, kind = kindOf(id)) }
          if (node == null) LibraryResult.ofError(SessionError.ERROR_BAD_VALUE) else LibraryResult.ofItem(browseItem(node), null)
        }
      }
    }
  }

  override fun onSearch(session: MediaLibrarySession, browser: MediaSession.ControllerInfo, query: String, params: LibraryParams?): ListenableFuture<LibraryResult<Void>> =
    library {
      val n = searchNodes(query).size
      session.notifySearchResultChanged(browser, query, n, params)
      LibraryResult.ofVoid()
    }

  override fun onGetSearchResult(
    session: MediaLibrarySession,
    browser: MediaSession.ControllerInfo,
    query: String,
    page: Int,
    pageSize: Int,
    params: LibraryParams?,
  ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
    library { LibraryResult.ofItemList(CarTree.page(searchNodes(query), page, pageSize).map(::browseItem), null) }

  /** A search's rows: its songs, then its albums. onSearch runs it, onGetSearchResult pages it. */
  private suspend fun searchNodes(query: String): List<CarNode> {
    if (query.isBlank()) return emptyList()
    searches[query]?.takeIf { System.currentTimeMillis() - it.first < CACHE_MS }?.let { return it.second }
    val r = app.library.searchRemote(query)
    val id = CarId.Search(query)
    songs[id.format()] = Songs("“${query.trim()}”", r.tracks)
    val nodes = CarTree.songs(id, r.tracks) + CarTree.albums(r.albums)
    searches[query] = System.currentTimeMillis() to nodes
    return nodes
  }

  /** A node's rows; null for an id that names nothing. */
  private suspend fun children(id: CarId, limit: Int): List<CarNode>? =
    when (id) {
      CarId.Root -> CarTree.root(limit)
      CarId.More -> CarTree.more(limit)
      is CarId.Shelf ->
        when (id.shelf) {
          CarShelf.Recent -> CarTree.albums(app.library.albumList(AlbumList.Recent, CarTree.ALBUMS))
          CarShelf.Albums -> CarTree.albums(app.library.albumList(AlbumList.Newest, CarTree.ALBUMS))
          CarShelf.Playlists -> CarTree.playlists(app.library.playlists())
          CarShelf.Mixes -> CarTree.mixes(app.library.mixes())
          CarShelf.Liked -> load(id)?.let { CarTree.songs(id, it.tracks) }
        }
      is CarId.Song -> null
      else -> load(id, fresh = true)?.let { CarTree.songs(id, it.tracks) }
    }

  /** A list's songs: an album, a playlist, a mix, Liked songs or a search. */
  private suspend fun load(id: CarId, fresh: Boolean = false): Songs? {
    val key = id.format()
    songs[key]?.takeIf { !fresh && System.currentTimeMillis() - it.at < CACHE_MS }?.let { return it }
    val s =
      when (id) {
        is CarId.Album -> app.library.loadAlbum(id.id)?.let { Songs(it.title, it.tracks) }
        is CarId.Playlist -> app.library.playlist(id.id)?.let { Songs(it.playlist.name, it.entries) }
        is CarId.Mix -> app.library.mixes().firstOrNull { it.id == id.id }?.let { m -> Songs(m.title, m.tracks.map { it.toTrack() }) }
        is CarId.Search -> Songs("“${id.query.trim()}”", app.library.searchRemote(id.query).tracks)
        CarId.Shelf(CarShelf.Liked) -> Songs("Liked songs", app.library.starred())
        else -> null
      } ?: return null
    songs[key] = s
    return s
  }

  // ---- playing what a browser picked ----

  override fun onAddMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> {
    if (mediaItems.all { it.localConfiguration != null }) return Futures.immediateFuture(mediaItems.map(::withContentArt).toMutableList())
    return future { mediaItems.flatMap { single(it) }.toMutableList() }
  }

  override fun onSetMediaItems(
    mediaSession: MediaSession,
    controller: MediaSession.ControllerInfo,
    mediaItems: MutableList<MediaItem>,
    startIndex: Int,
    startPositionMs: Long,
  ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
    // The app's own controller: its items as they are (their covers made openable by other apps).
    if (mediaItems.all { it.localConfiguration != null }) {
      return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(mediaItems.map(::withContentArt), startIndex, startPositionMs))
    }
    return future {
      val one = mediaItems.singleOrNull()
      val query = one?.requestMetadata?.searchQuery
      val id = one?.mediaId?.let(CarId::parse)
      when {
        // "Play … on ECHO": the songs found, else the first album found; nothing said, Liked songs.
        query != null -> fromSearch(query)
        id is CarId.Song -> list(id.parent, id.trackId)
        id != null && id.holdsSongs -> list(id, null)
        else -> {
          val items = mediaItems.flatMap { single(it) }
          MediaSession.MediaItemsWithStartPosition(items, if (items.isEmpty()) 0 else startIndex.coerceIn(0, items.lastIndex), startPositionMs)
        }
      }.also {
        // Nothing to play leaves what plays alone: the browser gets an error instead.
        check(it.mediaItems.isNotEmpty()) { "nothing to play" }
      }
    }
  }

  /** A list to play from one of its songs (or from the top): the whole list, as the app plays it. */
  private suspend fun list(parent: CarId, trackId: String?): MediaSession.MediaItemsWithStartPosition {
    val s = load(parent) ?: return MediaSession.MediaItemsWithStartPosition(emptyList(), 0, 0)
    val start = if (trackId == null) 0 else CarTree.startIndex(s.tracks, trackId)
    adopt(CarTree.contextOf(parent, s.title))
    return MediaSession.MediaItemsWithStartPosition(s.tracks.map(::playerItem), start, 0)
  }

  private suspend fun fromSearch(query: String): MediaSession.MediaItemsWithStartPosition {
    if (query.isBlank()) return list(CarId.Shelf(CarShelf.Liked), null)
    val r = app.library.searchRemote(query)
    if (r.tracks.isEmpty()) r.albums.firstOrNull()?.let { return list(CarId.Album(it.id), null) }
    val id = CarId.Search(query)
    songs[id.format()] = Songs("“${query.trim()}”", r.tracks)
    return list(id, null)
  }

  /** One item as one song: a song of a list, or a song the player had before (its key). */
  private suspend fun single(item: MediaItem): List<MediaItem> {
    if (item.localConfiguration != null) return listOf(withContentArt(item))
    KnownTracks[item.mediaId]?.let { return listOf(playerItem(it)) }
    val id = CarId.parse(item.mediaId) as? CarId.Song ?: return emptyList()
    val t = load(id.parent)?.tracks?.firstOrNull { it.id == id.trackId } ?: return emptyList()
    return listOf(playerItem(t))
  }

  /** The in-app player learns where the music now plays from (the history's context). */
  private fun adopt(ctx: PlayContext?) {
    if (ctx != null) app.playback.playingFrom(ctx)
  }

  // ---- items ----

  private fun playerItem(t: Track): MediaItem {
    KnownTracks.put(t)
    return MediaItem.Builder()
      .setMediaId(t.key)
      .setUri(app.api.url(CarTree.streamPath(t.id)))
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(t.title)
          .setArtist(t.artist)
          .setAlbumTitle(t.album.title)
          .setArtworkUri(ArtworkProvider.uriFor(app, t.cover))
          .setDurationMs(t.durationMs.takeIf { it > 0 })
          .setIsBrowsable(false)
          .setIsPlayable(true)
          .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
          .build(),
      )
      .build()
  }

  /** The app's items carry https covers, which need the token: the provider's URI instead. */
  private fun withContentArt(item: MediaItem): MediaItem {
    val art = item.mediaMetadata.artworkUri?.toString() ?: return item
    val uri = ArtworkProvider.uriFor(app, art) ?: return item
    return item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setArtworkUri(uri).build()).build()
  }

  private fun kindOf(id: CarId) =
    when (id) {
      is CarId.Album -> CarKind.Album
      is CarId.Playlist -> CarKind.Playlist
      is CarId.Mix -> CarKind.Mix
      else -> CarKind.Folder
    }

  private fun folder(id: String, title: String, type: Int) =
    MediaItem.Builder()
      .setMediaId(id)
      .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false).setMediaType(type).build())
      .build()

  private fun browseItem(n: CarNode): MediaItem {
    val type =
      when (n.kind) {
        CarKind.Song -> MediaMetadata.MEDIA_TYPE_MUSIC
        CarKind.Album -> MediaMetadata.MEDIA_TYPE_ALBUM
        CarKind.Playlist, CarKind.Mix -> MediaMetadata.MEDIA_TYPE_PLAYLIST
        CarKind.Folder ->
          when (CarId.parse(n.id)) {
            CarId.Shelf(CarShelf.Playlists), CarId.Shelf(CarShelf.Mixes) -> MediaMetadata.MEDIA_TYPE_FOLDER_PLAYLISTS
            CarId.Shelf(CarShelf.Recent), CarId.Shelf(CarShelf.Albums) -> MediaMetadata.MEDIA_TYPE_FOLDER_ALBUMS
            else -> MediaMetadata.MEDIA_TYPE_FOLDER_MIXED
          }
      }
    val md =
      MediaMetadata.Builder()
        .setTitle(n.title)
        .setSubtitle(n.subtitle)
        .setIsBrowsable(n.browsable)
        .setIsPlayable(n.playable)
        .setMediaType(type)
        .setArtworkUri(ArtworkProvider.uriFor(app, n.art))
    if (n.kind == CarKind.Song) md.setArtist(n.subtitle).setAlbumTitle(n.track?.album?.title).setDurationMs(n.durationMs)
    // Lists of songs show as lists; everything else (albums, playlists, mixes) as a grid of covers.
    // More's rows are shelves without covers: a list too.
    when (if (n.kind == CarKind.Folder) CarId.parse(n.id) else null) {
      CarId.Shelf(CarShelf.Liked) -> md.setExtras(Bundle().apply { putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM) })
      CarId.More -> md.setExtras(Bundle().apply { putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM) })
      else -> {}
    }
    return MediaItem.Builder().setMediaId(n.id).setMediaMetadata(md.build()).build()
  }

  // ---- futures ----

  /** A library answer: signed out and failures are errors the car can show, never a crash. */
  private fun <T : Any> library(block: suspend () -> LibraryResult<T>): ListenableFuture<LibraryResult<T>> =
    future {
      if (app.tokens.token.value == null) {
        LibraryResult.ofError<T>(SessionError(SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED, "Sign in to ECHO on your phone."))
      } else {
        try {
          block()
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          LibraryResult.ofError<T>(SessionError(SessionError.ERROR_IO, "Couldn't reach your library."))
        }
      }
    }

  private fun <T> future(block: suspend () -> T): ListenableFuture<T> {
    val f = SettableFuture.create<T>()
    scope.launch {
      try {
        f.set(block())
      } catch (e: CancellationException) {
        f.cancel(false)
      } catch (e: Exception) {
        f.setException(e)
      }
    }
    return f
  }

  /** Signed out: nothing of the last account stays. */
  fun clear() {
    songs.clear()
    searches.clear()
    KnownTracks.clear()
  }
}
