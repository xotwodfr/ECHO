package com.folk3s.echo

import com.folk3s.echo.api.Album
import com.folk3s.echo.api.AlbumRef
import com.folk3s.echo.api.ArtistRef
import com.folk3s.echo.api.Artwork
import com.folk3s.echo.api.Mix
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.Playlist
import com.folk3s.echo.api.Track
import com.folk3s.echo.api.TrackRef
import com.folk3s.echo.playback.CarId
import com.folk3s.echo.playback.CarKind
import com.folk3s.echo.playback.CarShelf
import com.folk3s.echo.playback.CarTree
import com.folk3s.echo.playback.coverPath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Android Auto's browse tree (CarTree): ids that round-trip, the root under the car's tab limit,
// songs that play their whole list, paging, and the covers the artwork provider may serve.
class CarTreeTest {
  private fun track(id: String, title: String = "Song $id") =
    Track(
      key = "navidrome:$id",
      id = id,
      title = title,
      artists = listOf(ArtistRef("ar1", "Artist")),
      album = AlbumRef("al1", "Album", "navidrome:al1"),
      durationMs = 200_000,
      artwork = listOf(Artwork("/api/v1/navidrome/cover/al1?size=600")),
    )

  @Test
  fun `every id round-trips, odd characters and nesting too`() {
    val ids =
      listOf(
        CarId.Root,
        CarId.More,
        CarId.Shelf(CarShelf.Liked),
        CarId.Album("a/b c?d&e"),
        CarId.Playlist("3f2a-11"),
        CarId.Mix("daylist"),
        CarId.Search("AC/DC – back in black"),
        CarId.Song(CarId.Album("al/1"), "tr/9"),
        CarId.Song(CarId.Shelf(CarShelf.Liked), "x"),
        CarId.Song(CarId.Search("a/b"), "y"),
      )
    for (id in ids) assertEquals(id, CarId.parse(id.format()))
  }

  @Test
  fun `ids that name nothing parse to null`() {
    for (s in listOf("", "album", "album/", "shelf/nope", "nope/x", "song/x", "song/x/shelf%2Frecent", "song/x/garbage")) assertNull(s, CarId.parse(s))
  }

  @Test
  fun `only lists of songs hold songs`() {
    assertTrue(CarId.Album("a").holdsSongs)
    assertTrue(CarId.Shelf(CarShelf.Liked).holdsSongs)
    assertTrue(CarId.Search("q").holdsSongs)
    assertFalse(CarId.Shelf(CarShelf.Albums).holdsSongs)
    assertFalse(CarId.Root.holdsSongs)
  }

  @Test
  fun `the root shows every shelf, or as many as the car shows and More`() {
    assertEquals(CarShelf.entries.map { CarId.Shelf(it).format() }, CarTree.root().map { it.id })
    val four = CarTree.root(4)
    assertEquals(4, four.size)
    assertEquals(CarId.More.format(), four.last().id)
    // Nothing lost: the root's shelves and More's together are every shelf, once.
    val shown = four.dropLast(1).map { it.id } + CarTree.more(4).map { it.id }
    assertEquals(CarShelf.entries.map { CarId.Shelf(it).format() }, shown)
    assertEquals(CarShelf.entries.size, CarTree.more(1).size)
    assertTrue(CarTree.more(0).isEmpty())
    assertTrue(CarTree.root().all { it.browsable && !it.playable })
  }

  @Test
  fun `a song plays its list from where it is`() {
    val list = listOf(track("1"), track("2"), track("3"), track("2"))
    val parent = CarId.Playlist("p1")
    val nodes = CarTree.songs(parent, list)
    assertTrue(nodes.all { it.playable && it.kind == CarKind.Song })
    val song = CarId.parse(nodes[2].id) as CarId.Song
    assertEquals(parent, song.parent)
    assertEquals(2, CarTree.startIndex(list, song.trackId))
    assertEquals(1, CarTree.startIndex(list, "2"))
    assertEquals(0, CarTree.startIndex(list, "gone"))
    assertEquals("Artist", nodes[0].subtitle)
    assertEquals("/api/v1/navidrome/cover/al1?size=600", nodes[0].art)
  }

  @Test
  fun `albums, playlists and mixes are folders with covers`() {
    val a = CarTree.albums(listOf(Album("al1", "Blue", "Joni", cover = "/c"), Album("al2", "Untitled", "")))
    assertEquals(listOf("album/al1", "album/al2"), a.map { it.id })
    assertEquals("Joni", a[0].subtitle)
    assertNull(a[1].subtitle)
    assertTrue(a.all { it.browsable })
    assertEquals("12 songs", CarTree.playlists(listOf(Playlist("p", "Road", 12))).single().subtitle)
    val ref = TrackRef("t", "T", "A", album = "Al", durationMs = 1, cover = "/cover")
    val mixes = CarTree.mixes(listOf(Mix("m1", "daily", "Daily Mix 1", "", listOf(ref)), Mix("m2", "daily", "Empty", "", emptyList())))
    assertEquals(listOf("mix/m1"), mixes.map { it.id })
    assertEquals("/cover", mixes[0].art)
    assertNull(mixes[0].subtitle)
  }

  @Test
  fun `pages slice the list, and no paging is everything`() {
    val l = (0 until 25).toList()
    assertEquals((0 until 10).toList(), CarTree.page(l, 0, 10))
    assertEquals((20 until 25).toList(), CarTree.page(l, 2, 10))
    assertTrue(CarTree.page(l, 3, 10).isEmpty())
    assertTrue(CarTree.page(l, -1, 10).isEmpty())
    assertEquals(l, CarTree.page(l, 0, Int.MAX_VALUE))
    assertEquals(l, CarTree.page(l, 0, 0))
    assertTrue(CarTree.page(l, 1, Int.MAX_VALUE).isEmpty())
  }

  @Test
  fun `the history learns what the car played from`() {
    assertEquals(PlayContext("album", "a", "Blue"), CarTree.contextOf(CarId.Album("a"), "Blue"))
    assertEquals(PlayContext("starred", title = "Liked Songs"), CarTree.contextOf(CarId.Shelf(CarShelf.Liked), "x"))
    assertEquals(PlayContext("search", title = "“abba”"), CarTree.contextOf(CarId.Search(" abba "), "x"))
    assertNull(CarTree.contextOf(CarId.Root, "x"))
  }

  @Test
  fun `streams are the app's, and only covers go through the artwork provider`() {
    assertEquals("/api/v1/navidrome/stream/a%2Fb?format=raw", CarTree.streamPath("a/b"))
    val base = "https://echo.example"
    assertEquals("/api/v1/navidrome/cover/x?size=300", coverPath("/api/v1/navidrome/cover/x?size=300", base))
    assertEquals("/api/v1/navidrome/cover/x", coverPath("$base/api/v1/navidrome/cover/x", base))
    assertNull(coverPath("https://elsewhere/api/v1/navidrome/cover/x", base))
    assertNull(coverPath("/api/v1/me/queue", base))
    assertNull(coverPath("/api/v1/navidrome/cover/../../me/queue", base))
    assertNull(coverPath(null, base))
  }
}
