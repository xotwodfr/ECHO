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

  override fun onCreate() {
    super.onCreate()
    // A revoked token signs this device out; signing in (again) loads that account's library.
    scope.launch { api.revoked.collect { tokens.set(null) } }
    scope.launch {
      var signedIn = false
      tokens.token.collect { t ->
        library.clear()
        if (t != null) library.reload()
        // Signed out: the next account must not get this queue or this music (REL-05).
        else if (signedIn) playback.reset()
        signedIn = t != null
      }
    }
  }

  /** Covers through the same client, so they carry the device token. */
  override fun newImageLoader(context: PlatformContext): ImageLoader =
    ImageLoader.Builder(context)
      .components { add(OkHttpNetworkFetcherFactory(callFactory = { api.http })) }
      .crossfade(true)
      .build()
}

val Context.echo: EchoApp get() = applicationContext as EchoApp
