package com.folk3s.echo

import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.together.ClockSync
import com.folk3s.echo.together.Local
import com.folk3s.echo.together.Step
import com.folk3s.echo.together.Target
import com.folk3s.echo.together.TogetherState
import com.folk3s.echo.together.cuePoint
import com.folk3s.echo.together.expectedPosition
import com.folk3s.echo.together.plan
import com.folk3s.echo.together.togetherIdOf
import kotlinx.serialization.json.decodeFromJsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Listen together's arithmetic, as on the web (src/client/together/sync.test.ts).
class TogetherTest {
  private val base = "https://echo.folk3s.com"

  @Test
  fun `the clock takes the shortest round trip, and a pushed event only raises it`() {
    val c = ClockSync()
    c.request(1_010_390, 1_000_000, 1_000_400)
    assertEquals(10_190.0, c.offset!!, 0.1)
    c.request(1_012_010, 1_002_000, 1_002_020)
    assertEquals(10_000.0, c.offset!!, 0.1)
    c.pushed(1_020_000, 1_010_100) // at least 9900: no news
    assertEquals(10_000.0, c.offset!!, 0.1)
    c.pushed(1_030_000, 1_019_990) // at least 10010
    assertEquals(10_010.0, c.offset!!, 0.1)
    assertEquals(2_010_010L, c.toServer(2_000_000))
  }

  @Test
  fun `the position is server now minus startedAt, or where it paused`() {
    assertEquals(25_500L, expectedPosition(true, 40_000, 10_000, 50_000, 200_000, 65_500))
    assertEquals(200_000L, expectedPosition(true, 0, 0, 0, 200_000, 999_999))
    assertEquals(12_345L, expectedPosition(false, null, 12_345, 0, 200_000, 9_999_999))
  }

  @Test
  fun `the player loads, seeks past the tolerance, plays and pauses with the host`() {
    val t = Target("s1", playing = true, positionMs = 60_000, durationMs = 200_000)
    val l = Local("s1", active = true, loading = false, positionMs = 60_000)
    assertEquals(Step.Load(60_000, true), plan(t, l.copy(trackId = null)))
    assertNull(plan(t, l.copy(positionMs = 60_299)))
    assertEquals(Step.Seek(60_000), plan(t, l.copy(positionMs = 60_500)))
    assertNull(plan(t, l.copy(positionMs = 59_000), settling = true))
    assertEquals(Step.Play, plan(t, l.copy(active = false)))
    assertEquals(Step.Pause(60_000), plan(t.copy(playing = false), l))
    assertNull(plan(t.copy(playing = false, positionMs = 60_772), l.copy(active = false))) // a transcode's whole second
    assertNull(plan(t.copy(positionMs = 199_500), l.copy(active = false, positionMs = 200_000))) // ended here first
    assertEquals(Step.Stop, plan(Target(null, false, 0, 0), l))
  }

  @Test
  fun `a cue lands on a whole second ahead`() {
    assertEquals(5000L to 2228L, cuePoint(2772, 200_000))
    assertEquals(198_000L to 0L, cuePoint(198_000, 200_000))
  }

  @Test
  fun `a session link for this server is read, anything else is not`() {
    assertEquals("Ab12-cd34_EF56gh78ijKLmnop", togetherIdOf("https://echo.folk3s.com/together/Ab12-cd34_EF56gh78ijKLmnop", base))
    assertNull(togetherIdOf("https://echo.folk3s.com.evil.test/together/Ab12-cd34_EF56gh78ijKLmnop", base))
    assertNull(togetherIdOf("https://echo.folk3s.com/guest#Ab12-cd34_EF56gh78ijKLmnop", base))
    assertNull(togetherIdOf("https://echo.folk3s.com/together/short", base))
  }

  @Test
  fun `the server's state is read`() {
    val json =
      """{"id":"abc","url":"https://echo.folk3s.com/together/abc","host":{"id":1,"username":"ada"},"you":{"id":2,"host":false,"member":true},
        "members":[{"id":1,"username":"ada","host":true,"online":true}],"now":{"uid":"u1","track":{"id":"s1","title":"T","artist":"A","album":"B","durationMs":1000},"addedBy":{"id":1,"username":"ada"}},
        "queue":[],"playing":true,"startedAt":5,"positionMs":10,"serverTime":15,"version":3,"createdAt":1}"""
    val s = EchoJson.decodeFromJsonElement<TogetherState>(EchoJson.parseToJsonElement(json))
    assertEquals("s1", s.now?.track?.id)
    assertEquals(5L, s.startedAt)
  }
}
