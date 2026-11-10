package com.folk3s.echo

import com.folk3s.echo.playback.savedPositionMs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

// The saved queue (`/api/v1/me/queue`) as the web writes it: its position is a fraction of a ms.
class QueueTest {
  private fun saved(s: String) = Json.parseToJsonElement(s).jsonObject

  @Test
  fun `a saved position is any JSON number, the web's fractions too`() {
    assertEquals(8341L, savedPositionMs(saved("""{"positionMs":8341.517}""")))
    assertEquals(8341L, savedPositionMs(saved("""{"positionMs":8341}""")))
    assertEquals(0L, savedPositionMs(saved("""{"positionMs":null}""")))
    assertEquals(0L, savedPositionMs(saved("""{}""")))
  }

  @Test
  fun `a saved queue writes its empty lists and provider, which the web reads`() {
    val q = com.folk3s.echo.api.EchoJsonFull.encodeToJsonElement(com.folk3s.echo.api.QueueState.serializer(), com.folk3s.echo.api.QueueState()).jsonObject
    assertEquals("[]", q["nextUp"].toString())
    assertEquals("\"navidrome\"", q["provider"].toString())
  }

  @Test
  fun `a long queue is cut to fit the server, from its far end`() {
    val songs = (0 until 3000).map { com.folk3s.echo.api.TrackRef("a$it", "Song number $it", "An artist", "ar1", "An album", "al1", 200_000, "/api/v1/navidrome/cover/al1").toTrack() }
    val q = com.folk3s.echo.api.QueueState(now = songs[0], context = songs.drop(1), nextUp = songs.take(5))
    val size = { s: com.folk3s.echo.api.QueueState -> com.folk3s.echo.api.EchoJsonFull.encodeToString(com.folk3s.echo.api.QueueState.serializer(), s).toByteArray().size }
    org.junit.Assert.assertTrue(size(q) > 64 * 1024) // the server would refuse it
    val cut = com.folk3s.echo.playback.fitted(q)
    org.junit.Assert.assertTrue(size(cut) <= 60_000)
    assertEquals("a1", cut.context[0].id)
    assertEquals(5, cut.nextUp.size)
    assertEquals(q.copy(context = songs.subList(1, 3)), com.folk3s.echo.playback.fitted(q.copy(context = songs.subList(1, 3))))
  }

  @Test
  fun `a retry waits 300 ms then 900 ms, half to one and a half times`() {
    assertEquals(150L, com.folk3s.echo.api.retryDelay(0, 0.0))
    assertEquals(1350L, com.folk3s.echo.api.retryDelay(1, 1.0))
  }
}
