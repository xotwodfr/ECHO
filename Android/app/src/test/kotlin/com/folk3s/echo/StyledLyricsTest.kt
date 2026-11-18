package com.folk3s.echo

import com.folk3s.echo.api.Attribution
import com.folk3s.echo.api.BackgroundLine
import com.folk3s.echo.api.LyricLine
import com.folk3s.echo.api.LyricWord
import com.folk3s.echo.api.LyricsDoc
import com.folk3s.echo.stage.lyrics.Slot
import com.folk3s.echo.stage.lyrics.slotsOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The lyric styles' model (stage/lyrics/Styled.kt): lines with their words' places in the text,
// dots where the singing stops for 5 s or more, backing vocals under their line.
class StyledLyricsTest {
  private fun doc(vararg lines: LyricLine) = LyricsDoc(trackKey = "navidrome:t1", sync = "word", source = "test", attribution = Attribution("test"), lines = lines.toList())

  @Test
  fun wordsKeepTheirPlacesAndSpaces() {
    val slots = slotsOf(doc(LyricLine("Hello wonderful", 1000, 3000, words = listOf(LyricWord("Hel", 1000, 1300, isPartOfWord = true), LyricWord("lo", 1300, 1600), LyricWord("wonderful", 1700, 3000)))))
    val line = (slots.single() as Slot.Line).line
    assertEquals("Hello wonderful", line.text)
    assertEquals(listOf(0 to 3, 3 to 5, 6 to 15), line.words.map { it.from to it.to })
    assertTrue(line.wordTimed)
  }

  @Test
  fun longGapsGetDotsAndAnIntroGetsThemToo() {
    val slots = slotsOf(doc(LyricLine("one", 8000, 9000), LyricLine("two", 9500, 10_000), LyricLine("three", 20_000, 21_000)))
    assertEquals(listOf("Dots", "Line", "Line", "Dots", "Line"), slots.map { it::class.simpleName })
    val gap = slots[3] as Slot.Dots
    assertEquals(10_000L to 20_000L, gap.start to gap.end)
  }

  @Test
  fun lineTimedLinesAreOneWordAndBackingVocalsComeAlong() {
    val slots = slotsOf(doc(LyricLine("  la la  ", 0, null, background = listOf(BackgroundLine("ooh", 500, 900))), LyricLine("next", 2000, 3000)))
    val line = (slots.first() as Slot.Line).line
    assertEquals("la la", line.text)
    assertEquals(1, line.words.size)
    assertEquals(1900L, line.end) // 100 ms before the next line
    assertEquals("ooh", line.bg?.text)
  }
}
