package com.folk3s.echo

import com.folk3s.echo.api.durationText
import com.folk3s.echo.api.guestCodeOf
import com.folk3s.echo.api.linkCodeOf
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

  @Test
  fun `a computer's sign-in code is told apart from a guest code`() {
    assertEquals("Qx3kP9aL2mW7rT5vY8nB1c", linkCodeOf("https://echo.folk3s.com/link#Qx3kP9aL2mW7rT5vY8nB1c", base))
    assertNull(linkCodeOf("https://echo.folk3s.com/guest#Qx3kP9aL2mW7rT5vY8nB1c", base))
    assertNull(guestCodeOf("https://echo.folk3s.com/link#Qx3kP9aL2mW7rT5vY8nB1c", base))
    assertNull(linkCodeOf("https://evil.example/link#Qx3kP9aL2mW7rT5vY8nB1c", base))
  }
}

class UpdateTest {
  @Test
  fun `a newer release is noticed, part by part`() {
    org.junit.Assert.assertTrue(com.folk3s.echo.ui.isNewer("v0.8.0", "0.7.0"))
    org.junit.Assert.assertTrue(com.folk3s.echo.ui.isNewer("v0.10.0", "0.9.3"))
    org.junit.Assert.assertTrue(com.folk3s.echo.ui.isNewer("1.0", "0.99.9"))
    org.junit.Assert.assertFalse(com.folk3s.echo.ui.isNewer("v0.7.0", "0.7.0"))
    org.junit.Assert.assertFalse(com.folk3s.echo.ui.isNewer("v0.6.1", "0.7.0"))
  }
}
