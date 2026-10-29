package com.folk3s.echo.api

import kotlinx.serialization.Serializable

// The shared types (src/shared/types.ts) as the server sends and stores them. A Track's artwork
// URLs are server paths, as the web keeps them, so a queue saved on one device plays on another.

@Serializable data class ArtistRef(val id: String? = null, val name: String)

@Serializable data class AlbumRef(val id: String? = null, val title: String, val key: String)

@Serializable data class Artwork(val url: String, val width: Int? = null, val height: Int? = null)

@Serializable
data class ReplayGain(
  val trackGain: Double? = null,
  val albumGain: Double? = null,
  val trackPeak: Double? = null,
  val albumPeak: Double? = null,
)

@Serializable
data class Track(
  val key: String,
  val provider: String = "navidrome",
  val id: String,
  val title: String,
  val artists: List<ArtistRef>,
  val album: AlbumRef,
  val durationMs: Long,
  val artwork: List<Artwork> = emptyList(),
  val isrc: String? = null,
  val replayGain: ReplayGain? = null,
  val contentType: String? = null,
) {
  val artist: String get() = artists.joinToString(", ") { it.name }
  val cover: String? get() = artwork.firstOrNull()?.url
}

data class Album(
  val id: String,
  val title: String,
  val artist: String,
  val artistId: String? = null,
  val year: Int? = null,
  val cover: String? = null,
  val tracks: List<Track> = emptyList(),
) {
  val key: String get() = "navidrome:$id"
}

data class Playlist(val id: String, val name: String, val tracks: Int, val cover: String? = null, val owner: String? = null)

/** An artist as a reference with a picture (similar artists, search, starred). */
data class ArtistCard(val id: String, val name: String, val image: String? = null)

data class ArtistInfo(val bio: String?, val image: String?, val similar: List<ArtistCard>)

data class Genre(val name: String, val albums: Int)

data class PlaylistDetail(
  val playlist: Playlist,
  val comment: String?,
  val covers: List<String>,
  val entries: List<Track>,
) {
  val durationMs: Long get() = entries.sumOf { it.durationMs }
}

data class Starred(val tracks: List<Track> = emptyList(), val albums: List<Album> = emptyList(), val artists: List<ArtistCard> = emptyList())

@Serializable data class PlayContext(val kind: String, val id: String? = null, val title: String)

/** The saved queue (QueueState, `/api/v1/me/queue`), shared with the web player. */
@Serializable
data class QueueState(
  val provider: String? = "navidrome",
  val now: Track? = null,
  val nextUp: List<Track> = emptyList(),
  val context: List<Track> = emptyList(),
  val contextSource: PlayContext? = null,
  val history: List<Track> = emptyList(),
)

/** The album's palette (VISUALIZER_SPEC.md §6), CSS colours. */
@Serializable
data class Palette(
  val room: String,
  val accent: String,
  val highlight: String,
  val glow: String,
  val shadow: String,
  val inkActive: String? = null,
  val source: String? = null,
)

@Serializable
data class LyricWord(
  val text: String,
  val start: Long,
  val end: Long,
  val isPartOfWord: Boolean = false,
)

@Serializable
data class BackgroundLine(
  val text: String,
  val start: Long? = null,
  val end: Long? = null,
  val words: List<LyricWord>? = null,
)

@Serializable
data class LyricLine(
  val text: String,
  val start: Long = 0,
  val end: Long? = null,
  val agent: String? = null,
  val oppositeAligned: Boolean = false,
  val words: List<LyricWord>? = null,
  val background: List<BackgroundLine>? = null,
)

@Serializable data class Link(val label: String, val href: String)

@Serializable data class Attribution(val text: String, val links: List<Link>? = null)

@Serializable data class Agent(val id: String, val name: String? = null, val kind: String = "person")

@Serializable
data class LyricsDoc(
  val version: Int = 1,
  val trackKey: String,
  val sync: String, // word | line | none
  val source: String,
  val attribution: Attribution,
  val language: String? = null,
  val offsetMs: Long = 0,
  val durationMs: Long? = null,
  val agents: List<Agent>? = null,
  val lines: List<LyricLine>,
)

@Serializable data class Override(val offsetMs: Long? = null, val pinnedSource: String? = null)

@Serializable data class LyricsAnswer(val doc: LyricsDoc? = null, val override: Override? = null)

// ECHO's own play history and what is made from it (src/server/plays.ts).

/** A Navidrome song as the history keeps it. */
@Serializable
data class TrackRef(
  val id: String,
  val title: String,
  val artist: String,
  val artistId: String? = null,
  val album: String,
  val albumId: String? = null,
  val durationMs: Long,
  val cover: String? = null,
) {
  fun toTrack() =
    Track(
      key = "navidrome:$id",
      id = id,
      title = title,
      artists = listOf(ArtistRef(artistId, artist)),
      album = AlbumRef(albumId, album, "navidrome:${albumId ?: id}"),
      durationMs = durationMs,
      artwork = listOfNotNull(cover?.let { Artwork(it) }),
    )
}

/** One of Made For You's mixes. */
@Serializable data class Mix(val id: String, val kind: String, val title: String, val subtitle: String, val tracks: List<TrackRef>)

/** Jump back in: an album, playlist, artist or mix played from lately. */
@Serializable data class PlayedContext(val kind: String, val id: String, val title: String? = null, val cover: String? = null, val at: Long)

@Serializable data class WrappedArtist(val name: String, val id: String? = null, val plays: Int)

@Serializable
data class WrappedTrack(
  val id: String,
  val title: String,
  val artist: String,
  val artistId: String? = null,
  val album: String,
  val albumId: String? = null,
  val durationMs: Long,
  val cover: String? = null,
  val plays: Int,
) {
  fun toTrack() = TrackRef(id, title, artist, artistId, album, albumId, durationMs, cover).toTrack()
}

@Serializable data class WrappedAlbum(val title: String, val id: String? = null, val artist: String, val cover: String? = null, val plays: Int)

@Serializable data class TopDay(val date: String, val plays: Int)

/** A year in review. */
@Serializable
data class Wrapped(
  val year: Int,
  val minutes: Int,
  val plays: Int,
  val artists: List<WrappedArtist> = emptyList(),
  val tracks: List<WrappedTrack> = emptyList(),
  val albums: List<WrappedAlbum> = emptyList(),
  val topDay: TopDay? = null,
  val distinctArtists: Int = 0,
)
