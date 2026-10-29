package com.folk3s.echo

import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.Mix
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.TrackRef
import com.folk3s.echo.api.Wrapped
import com.folk3s.echo.library.playBody
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// ECHO's play history from the phone (src/server/plays.ts): what a play sends, and the mixes and
// Wrapped as the server answers them.
class MixesTest {
  private val ref = TrackRef("al-1-t1", "Harbour Lights 1", "Lowfield", "ar-1", "Harbour Lights", "al-1", 200_000, "/api/v1/navidrome/cover/al-1?size=600")

  @Test
  fun `a history song plays as the Navidrome track it was`() {
    val t = ref.toTrack()
    assertEquals("navidrome:al-1-t1", t.key)
    assertEquals("navidrome", t.provider)
    assertEquals("Lowfield", t.artists.single().name)
    assertEquals("navidrome:al-1", t.album.key)
    assertEquals("/api/v1/navidrome/cover/al-1?size=600", t.artwork.single().url)
    assertEquals(emptyList<Any>(), ref.copy(cover = null).toTrack().artwork)
  }

  @Test
  fun `a play says its provider and what it was played from`() {
    val body = playBody(ref.toTrack(), PlayContext("album", "al-1", "Harbour Lights"))
    val track = body["track"]!!.jsonObject
    // The server keeps only Navidrome songs: the default provider must be in the JSON.
    assertEquals("navidrome", track["provider"]!!.jsonPrimitive.content)
    assertEquals("Lowfield", track["artists"]!!.jsonArray[0].jsonObject["name"]!!.jsonPrimitive.content)
    assertEquals("al-1", body["context"]!!.jsonObject["id"]!!.jsonPrimitive.content)
    assertNull(playBody(ref.toTrack(), null)["context"])
  }

  @Test
  fun `mixes and Wrapped read as the server sends them`() {
    val mix = EchoJson.decodeFromString<Mix>(
      """{"id":"daily-1","kind":"daily","title":"Daily Mix 1","subtitle":"Lowfield and more",
        "tracks":[{"id":"x","title":"X","artist":"Lowfield","album":"A","durationMs":1000}]}""",
    )
    assertEquals("x", mix.tracks.single().toTrack().id)
    val w = EchoJson.decodeFromString<Wrapped>(
      """{"year":2026,"minutes":15,"plays":5,"artists":[{"name":"Lowfield","plays":3}],
        "tracks":[{"id":"a","title":"A","artist":"Lowfield","album":"Al","durationMs":180000,"plays":3}],
        "albums":[],"topDay":null,"distinctArtists":1}""",
    )
    assertEquals(3, w.tracks.single().plays)
    assertNull(w.topDay)
  }
}
