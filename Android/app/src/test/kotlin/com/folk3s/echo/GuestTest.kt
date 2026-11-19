package com.folk3s.echo

import com.folk3s.echo.api.durationText
import com.folk3s.echo.api.guestCodeOf
import com.folk3s.echo.api.timeLeftText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Guest codes (src/server/guests.ts): the QR code holds `<origin>/guest#<code>`; the app joins only
// with a code for its own server.
class GuestTest {
  private val base = "https://echo.folk3s.com"

  @Test
  fun `a guest code for this server is read from the scanned link`() {
    assertEquals("Ab12-cd34_EF56gh78", guestCodeOf("https://echo.folk3s.com/guest#Ab12-cd34_EF56gh78", base))
    assertEquals("Ab12-cd34_EF56gh78", guestCodeOf("https://echo.folk3s.com/guest#Ab12-cd34_EF56gh78", "$base/"))
  }

  @Test
  fun `anything else is not a guest code`() {
    assertNull(guestCodeOf("https://other.example.com/guest#Ab12-cd34_EF56gh78", base)) // another server
    assertNull(guestCodeOf("https://echo.folk3s.com.evil.test/guest#Ab12-cd34_EF56gh78", base))
    assertNull(guestCodeOf("https://echo.folk3s.com/guest#short", base))
    assertNull(guestCodeOf("https://echo.folk3s.com/guest#has spaces in it here", base))
    assertNull(guestCodeOf("WIFI:S:home;T:WPA;P:secret;;", base))
  }

  @Test
  fun `durations and time left read as people say them`() {
    assertEquals("1 hour", durationText(3_600_000))
    assertEquals("1 day", durationText(86_400_000))
    assertEquals("1 week", durationText(7 * 86_400_000L))
    assertEquals("42 min left", timeLeftText(42 * 60_000L))
    assertEquals("18 h left", timeLeftText(18 * 3_600_000L))
    assertEquals("5 days left", timeLeftText(5 * 86_400_000L))
    assertEquals("0 min left", timeLeftText(-5))
  }
}
