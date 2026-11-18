package com.folk3s.echo

import com.folk3s.echo.games.GameRecord
import com.folk3s.echo.games.LIMIT_MS
import com.folk3s.echo.games.points
import org.junit.Assert.assertEquals
import org.junit.Test

// Games scoring: 50 for a right answer, up to 50 more for speed, a quarter off per hint taken; a
// record merges by keeping the better of each figure (this device's or the account's).
class GamesTest {
  @Test
  fun points() {
    assertEquals(100, points(0))
    assertEquals(75, points(LIMIT_MS / 2))
    assertEquals(50, points(LIMIT_MS))
    assertEquals(50, points(LIMIT_MS * 2))
    assertEquals(75, points(0, hints = 1))
    assertEquals(50, points(0, hints = 2))
    assertEquals(50, points(0, hints = 5))
  }

  @Test
  fun recordsMergeByTheBetterOfEach() {
    val here = GameRecord(best = 900, streak = 3, rounds = 4)
    val account = GameRecord(best = 700, streak = 8, rounds = 6)
    assertEquals(GameRecord(900, 8, 6), here.merge(account))
    assertEquals(here.merge(account), account.merge(here))
  }
}
