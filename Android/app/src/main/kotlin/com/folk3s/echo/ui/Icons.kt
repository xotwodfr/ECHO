package com.folk3s.echo.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

// ECHO's outline icons (src/client/ui/icons.tsx, DESIGN_SYSTEM.md §9.1): the same paths on a
// 24-unit grid at 1.5 stroke, round caps and joins. `Icon(tint = …)` colours them.

private class P(val d: String, val fill: Boolean = false)

private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0z"

private fun icon(name: String, vararg paths: P, filled: Boolean = false): ImageVector =
  ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
    .apply {
      for (p in paths) {
        addPath(
          pathData = PathParser().parsePathString(p.d).toNodes(),
          fill = if (filled || p.fill) SolidColor(Color.Black) else null,
          stroke = SolidColor(Color.Black),
          strokeLineWidth = 1.5f,
          strokeLineCap = StrokeCap.Round,
          strokeLineJoin = StrokeJoin.Round,
        )
      }
    }
    .build()

object EchoIcons {
  val play = icon("play", P("M7 4.5v15l12.5-7.5z"), filled = true)
  val pause = icon("pause", P("M6.5 5.5a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7.5a1 1 0 0 1-1-1z"), P("M14 5.5a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H15a1 1 0 0 1-1-1z"), filled = true)
  val previous = icon("previous", P("M18 5v14L8 12z"), P("M6 5v14"), filled = true)
  val next = icon("next", P("M6 5v14l10-7z"), P("M18 5v14"), filled = true)
  val home = icon("home", P("M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z"))
  val homeFilled = icon("homeFilled", P("M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z"), filled = true)
  val search = icon("search", P(circle(10.5f, 10.5f, 6.5f)), P("m15.5 15.5 5 5"))
  val library = icon("library", P("M4.5 4v16M9.5 4v16M14 4.6l5.5 15"))
  val plus = icon("plus", P("M12 5v14M5 12h14"))
  val heart = icon("heart", P("M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"))
  val heartFilled = icon("heartFilled", P("M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"), filled = true)
  val check = icon("check", P("m5 12.5 4.5 4.5L19 7.5"))
  val chevronDown = icon("chevronDown", P("m6 9 6 6 6-6"))
  val chevronLeft = icon("chevronLeft", P("m15 6-6 6 6 6"))
  val mic = icon("mic", P("M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"), P("M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"))
  val radio = icon("radio", P(circle(12f, 12f, 2f)), P("M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 18.7a9.5 9.5 0 0 0 0-13.4"))
  val user = icon("user", P(circle(12f, 8.5f, 4f)), P("M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5"))
  val moon = icon("moon", P("M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"))
  val music = icon("music", P("M9 17.5V6l10-2v11.5"), P(circle(6.5f, 17.5f, 2.5f)), P(circle(16.5f, 15.5f, 2.5f)))
  val volume = icon("volume", P("M4 9.5h3.5L12 5.5v13l-4.5-4H4z"), P("M15.5 9a4 4 0 0 1 0 6"), P("M18 6.5a7.5 7.5 0 0 1 0 11"))
  val shuffle =
    icon(
      "shuffle",
      P("M3 7h3.5c4 0 7 10 11 10H21"),
      P("M3 17h3.5c1.6 0 2.9-1.6 4-3.6"),
      P("M13.5 9.6c1.1-1.4 2.4-2.6 4-2.6H21"),
      P("m18.5 4.5 2.5 2.5-2.5 2.5"),
      P("m18.5 14.5 2.5 2.5-2.5 2.5"),
    )
  val smartShuffle =
    icon(
      "smartShuffle",
      P("M3 7h3.5c4 0 7 10 11 10H21"),
      P("M3 17h3.5c1.6 0 2.9-1.6 4-3.6"),
      P("M13.5 9.6c1.1-1.4 2.4-2.6 4-2.6H21"),
      P("m18.5 4.5 2.5 2.5-2.5 2.5"),
      P("m18.5 14.5 2.5 2.5-2.5 2.5"),
      P("M10 1.5v4M8 3.5h4"),
    )
  val repeat =
    icon("repeat", P("M4 11V9a3 3 0 0 1 3-3h13"), P("m17 3 3 3-3 3"), P("M20 13v2a3 3 0 0 1-3 3H4"), P("m7 21-3-3 3-3"))
  val repeatOne =
    icon(
      "repeatOne",
      P("M4 11V9a3 3 0 0 1 3-3h13"),
      P("m17 3 3 3-3 3"),
      P("M20 13v2a3 3 0 0 1-3 3H4"),
      P("m7 21-3-3 3-3"),
      P("M11 10.5 12.5 9.5v5"),
    )
  val queue = icon("queue", P("M4 6h16"), P("M4 12h16"), P("M4 18h10"))
  val settings =
    icon(
      "settings",
      P(circle(12f, 12f, 3f)),
      P("M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"),
    )
  val more =
    icon("more", P(circle(5.5f, 12f, 1f), fill = true), P(circle(12f, 12f, 1f), fill = true), P(circle(18.5f, 12f, 1f), fill = true))
  val close = icon("close", P("m6 6 12 12"), P("M18 6 6 18"))
  val alert = icon("alert", P(circle(12f, 12f, 9f)), P("M12 7.5v5.5"), P("M12 16.2v.3"))
  val info = icon("info", P(circle(12f, 12f, 9f)), P("M12 11v5.5"), P("M12 7.7v.3"))
  val lyrics = icon("lyrics", P("M4 6h12"), P("M4 10.5h16"), P("M4 15h9"), P("M4 19.5h13"))
  val visual = icon("visual", P("M3 12h3l2.5-6 4 12 3-9 2 3H21"))
  val brightness =
    icon(
      "brightness",
      P(circle(12f, 12f, 4f)),
      P("M12 8v8a4 4 0 0 0 0-8z", fill = true),
      P("M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"),
    )
  val fullscreen =
    icon(
      "fullscreen",
      P("M4 9V5a1 1 0 0 1 1-1h4"),
      P("M15 4h4a1 1 0 0 1 1 1v4"),
      P("M20 15v4a1 1 0 0 1-1 1h-4"),
      P("M9 20H5a1 1 0 0 1-1-1v-4"),
    )
}
