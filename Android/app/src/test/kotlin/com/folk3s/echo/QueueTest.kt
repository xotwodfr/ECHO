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
}
