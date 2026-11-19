package com.folk3s.echo

import android.app.Application
import android.content.Context
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.folk3s.echo.api.Api
import com.folk3s.echo.api.TokenStore
import com.folk3s.echo.library.Library
import com.folk3s.echo.playback.Playback
import com.folk3s.echo.stage.AlbumPalette
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** The app's singletons: one API client, one library, one player for the whole process. */
class EchoApp : Application(), SingletonImageLoader.Factory {
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  val tokens by lazy { TokenStore(this) }
  val api by lazy { Api(tokens) }
  val library by lazy { Library(api, scope) }
  val playback by lazy { Playback(this) }
  val palette by lazy { AlbumPalette(this) }
  val prefs by lazy { PrefsStore(this) }
  val lyrics by lazy { com.folk3s.echo.stage.lyrics.Lyrics(this) }
  val games by lazy { com.folk3s.echo.games.GameScores(this) }
  val sounds by lazy { com.folk3s.echo.ui.ThemeSounds(this) }
  val karaoke by lazy { com.folk3s.echo.playback.Karaoke(this) }
  val guests by lazy { com.folk3s.echo.ui.GuestState(this) }
  val network by lazy { com.folk3s.echo.offline.Network(this) }
  val downloads by lazy { com.folk3s.echo.offline.Downloads(this) }

  override fun onCreate() {
    super.onCreate()
    // A revoked token signs this device out; signing in (again) loads that account's library.
    scope.launch { api.revoked.collect { tokens.set(null) } }
    downloads.start()
    // Back online after a while without ECHO: the library comes back by itself (v0.8).
    scope.launch {
      network.online.drop(1).collect { on ->
        if (on && tokens.token.value != null) {
          if (library.status.value != com.folk3s.echo.library.Status.Ready || library.albums.value.isEmpty()) library.reload()
          library.refreshCollections()
        }
      }
    }
    scope.launch {
      var signedIn = false
      tokens.token.collect { t ->
        library.clear()
        if (t != null) {
          library.reload()
          launch {
            guests.refresh()
            // The sign-in wall's covers: this account's library (not a guest's phone).
            if (!guests.isGuest) {
              val albums = library.albums.first { it.isNotEmpty() }
              com.folk3s.echo.ui.CoverWall.refresh(this@EchoApp, albums.mapNotNull { it.cover })
            }
          }
        } else {
          guests.clear()
          // Signed out: the next account must not get this queue or this music (REL-05).
          if (signedIn) {
            playback.reset()
            games.clear()
            karaoke.clear()
            downloads.clear()
            // The car's cover cache (ArtworkProvider), and the sign-in wall's: the next account sees none of these.
            java.io.File(cacheDir, "artwork").deleteRecursively()
          }
        }
        signedIn = t != null
      }
    }
  }

  /** Covers through the same client, so they carry the device token. */
  override fun newImageLoader(context: PlatformContext): ImageLoader =
    ImageLoader.Builder(context)
      .components {
        // A downloaded cover is read from its file, at any size asked for (offline too).
        add(coil3.map.Mapper<String, String> { data, _ -> downloads.coverUri(data) })
        add(OkHttpNetworkFetcherFactory(callFactory = { api.http }))
      }
      .crossfade(true)
      .build()
}

val Context.echo: EchoApp get() = applicationContext as EchoApp
