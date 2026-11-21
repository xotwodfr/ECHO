package com.folk3s.echo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import com.folk3s.echo.ui.EchoRoot

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Edge to edge; the bar icons follow the system's light or dark theme (Now Playing and the
    // lyrics view turn them light while they are open).
    enableEdgeToEdge(SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT), SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT))
    echo.karaoke // Karaoke mode follows the player while the app is open (docs/KARAOKE.md)
    setContent { EchoRoot() }
    openLink(intent)
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    openLink(intent)
  }

  /** A Listen together link (`<origin>/together/<id>`) opened with the app: offered once signed in. */
  private fun openLink(intent: android.content.Intent?) {
    val id = com.folk3s.echo.ui.togetherLinkId(intent?.dataString, echo.api.base) ?: return
    echo.together.offer(id)
  }
}
