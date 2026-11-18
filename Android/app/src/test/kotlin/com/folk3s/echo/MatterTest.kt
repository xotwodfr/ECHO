package com.folk3s.echo

import androidx.compose.ui.graphics.Color
import com.folk3s.echo.ui.ThemePreset
import com.folk3s.echo.ui.matterColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

// The Clay and Yarn palettes (ui/Theme.kt): Clay in the dark takes the chosen colour, or the
// album's when set to follow it; light Clay and Yarn are fixed.
class MatterTest {
  private val album = Color(0xFF2266CC)

  @Test
  fun clayDarkTakesTheChosenColour() {
    val navy = matterColors(ThemePreset.Clay, true, "navy", album)
    assertEquals(Color(0xFF5C7BD1), navy.accent(0))
    assertEquals(navy, matterColors(ThemePreset.Clay, true, "navy", Color.Red))
  }

  @Test
  fun clayDarkFollowsTheAlbum() {
    val blue = matterColors(ThemePreset.Clay, true, "album", album)
    val red = matterColors(ThemePreset.Clay, true, "album", Color(0xFFCC2233))
    assertNotEquals(blue.accent(0), red.accent(0))
    // An unknown id falls back to the album too.
    assertEquals(blue, matterColors(ThemePreset.Clay, true, "nope", album))
  }

  @Test
  fun lightPalettesAreFixed() {
    assertEquals(matterColors(ThemePreset.Clay, false, "navy", album), matterColors(ThemePreset.Clay, false, "album", Color.Red))
    assertEquals(Color(0xFF8E2F4F), matterColors(ThemePreset.Yarn, false, "album", album).strong)
  }
}
