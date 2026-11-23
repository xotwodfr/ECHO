package com.folk3s.echo

import com.folk3s.echo.api.AlbumRef
import com.folk3s.echo.api.ArtistRef
import com.folk3s.echo.api.Artwork
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.Track
import com.folk3s.echo.offline.OfflineIndex
import com.folk3s.echo.offline.OfflineItem
import com.folk3s.echo.offline.chooseSource
import com.folk3s.echo.offline.coverIdOf
import com.folk3s.echo.offline.formatBytes
import com.folk3s.echo.offline.safeName
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Offline downloads (v0.8): which source a queued track plays from, and the index's bookkeeping.
class OfflineTest {
  private fun t(id: String, cover: String = "al-1") =
    Track("navidrome:$id", id = id, title = id, artists = listOf(ArtistRef(null, "A")), album = AlbumRef("1", "Al", "navidrome:1"), durationMs = 1000, artwork = listOf(Artwork("/api/v1/navidrome/cover/$cover?size=600")))

  private val stream = "https://echo/api/v1/navidrome/stream/x?format=raw"
  private val karaoke = "https://echo/api/v1/karaoke/x/audio"
  private val local = "file:///data/offline/tracks/x.opus"

  @Test fun theDownloadPlaysWhenThereIsOne() {
    assertEquals(local, chooseSource(stream, null, karaokeOn = false, local = local, online = true))
    assertEquals(local, chooseSource(stream, null, karaokeOn = false, local = local, online = false))
    assertEquals(stream, chooseSource(stream, null, karaokeOn = false, local = null, online = true))
  }

  @Test fun karaokeWinsOnlyOnlineAndReady() {
    // On, ready, online: the karaoke version, even over a download.
    assertEquals(karaoke, chooseSource(stream, karaoke, karaokeOn = true, local = local, online = true))
    // Offline: the download.
    assertEquals(local, chooseSource(stream, karaoke, karaokeOn = true, local = local, online = false))
    // Not ready yet: the download, else the stream.
    assertEquals(local, chooseSource(stream, null, karaokeOn = true, local = local, online = true))
    assertEquals(stream, chooseSource(stream, null, karaokeOn = true, local = null, online = true))
    // Karaoke mode off: never the karaoke version.
    assertEquals(stream, chooseSource(stream, karaoke, karaokeOn = false, local = null, online = true))
    assertEquals(local, chooseSource(stream, karaoke, karaokeOn = false, local = local, online = true))
  }

  @Test fun aSharedTrackStaysUntilEveryDownloadWithItGoes() {
    val album = OfflineItem("album", "1", "Al", tracks = listOf(t("a"), t("b")))
    val playlist = OfflineItem("playlist", "p", "Mix", tracks = listOf(t("b"), t("c", cover = "al-2")))
    var idx = OfflineIndex().put(album).put(playlist)
    idx = idx.copy(files = mapOf("a" to 100L, "b" to 200L, "c" to 300L), covers = mapOf("al-1" to 10L, "al-2" to 20L))
    assertEquals(630L, idx.totalBytes)
    assertEquals(300L, idx.bytes(album))
    assertEquals(500L, idx.bytes(playlist))

    val (rest, tracks, covers) = idx.remove("album:1")
    assertEquals(setOf("a"), tracks)
    // al-1 is still the playlist's track b's cover.
    assertEquals(emptySet<String>(), covers)
    assertEquals(mapOf("b" to 200L, "c" to 300L), rest.files)
    assertNull(rest.item("album", "1"))

    val (none, t2, c2) = rest.remove("playlist:p")
    assertEquals(setOf("b", "c"), t2)
    assertEquals(setOf("al-1", "al-2"), c2)
    assertEquals(0L, none.totalBytes)
    assertTrue(none.items.isEmpty())
  }

  @Test fun missingIsNewestFirstAndEachTrackOnce() {
    val idx = OfflineIndex()
      .put(OfflineItem("album", "1", "Al", tracks = listOf(t("a"), t("b"))))
      .put(OfflineItem("playlist", "p", "Mix", tracks = listOf(t("c"), t("b"))))
      .copy(files = mapOf("a" to 1L))
    assertEquals(listOf("c", "b"), idx.missing().map { it.id })
    assertEquals(listOf("al-1"), idx.missingCovers().map { it.first })
    val album = idx.item("album", "1")!!
    assertEquals(1, idx.done(album))
    assertFalse(idx.complete(album))
  }

  @Test fun replacingAnItemKeepsItsPlaceAndDate() {
    val first = OfflineItem("playlist", "p", "Mix", tracks = listOf(t("a")), addedAt = 5)
    val idx = OfflineIndex().put(first).put(OfflineItem("album", "1", "Al")).put(first.copy(tracks = listOf(t("a"), t("b")), addedAt = 9))
    assertEquals(2, idx.items.size)
    val p = idx.item("playlist", "p")!!
    assertEquals(5L, p.addedAt)
    assertEquals(2, p.tracks.size)
  }

  @Test fun theIndexSurvivesJson() {
    val idx = OfflineIndex().put(OfflineItem("liked", "liked", "Liked Songs", tracks = listOf(t("a")))).copy(files = mapOf("a" to 3L))
    assertEquals(idx, EchoJson.decodeFromString(OfflineIndex.serializer(), EchoJson.encodeToString(OfflineIndex.serializer(), idx)))
  }

  @Test fun coverIdsWhateverTheSize() {
    assertEquals("al-1", coverIdOf("/api/v1/navidrome/cover/al-1?size=160"))
    assertEquals("al-1", coverIdOf("https://echo.folk3s.com/api/v1/navidrome/cover/al-1?size=600"))
    assertEquals("a b", coverIdOf("/api/v1/navidrome/cover/a+b"))
    assertNull(coverIdOf("/api/v1/navidrome/stream/x"))
  }

  @Test fun fileNamesAreSafeAndDistinct() {
    assertEquals("abc-123_x.y", safeName("abc-123_x.y"))
    assertFalse(safeName("../etc").contains("/"))
    assertNotEquals(safeName("a/b"), safeName("a:b"))
  }

  @Test fun sizes() {
    assertEquals("512 B", formatBytes(512))
    assertEquals("840 KB", formatBytes(840_000))
    assertEquals("4.2 MB", formatBytes(4_200_000))
    assertEquals("84 MB", formatBytes(84_000_000))
    assertEquals("1.2 GB", formatBytes(1_200_000_000))
  }
}
