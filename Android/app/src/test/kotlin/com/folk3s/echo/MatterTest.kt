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

  @Test
  fun glassGlowsFollowTheAlbumAndItsPanesAreSeeThrough() {
    val red = matterColors(ThemePreset.Glass, true, "album", Color(0xFFD03050))
    val blue = matterColors(ThemePreset.Glass, true, "album", Color(0xFF3050D0))
    assert(red.accent(0) != blue.accent(0))
    // Text on a pane is the material's ink (white in the dark), whatever the tint's brightness.
    assertEquals(Color.White, com.folk3s.echo.ui.inkOn(red.accent(0), red.ink))
    assertEquals(Color.White, com.folk3s.echo.ui.inkOn(red.paper, red.ink))
  }

  @Test
  fun paperAndHiFiInkReadsOnTheirPanels() {
    val hifi = matterColors(ThemePreset.HiFi, true, "album", album)
    // Light ink on the wood; on a brushed-silver button, dark ink.
    assertEquals(Color(0xFF1E1E20), com.folk3s.echo.ui.inkOn(hifi.accent(0), hifi.ink))
    assertEquals(Color.White, com.folk3s.echo.ui.inkOn(hifi.paper, hifi.ink))
    val paper = matterColors(ThemePreset.Paper, false, "album", album)
    assertEquals(paper.ink, com.folk3s.echo.ui.inkOn(paper.paper, paper.ink))
  }
}
