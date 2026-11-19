package com.folk3s.echo.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.folk3s.echo.echo
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Playback that outlives the activity (PLAYBACK_ARCHITECTURE.md §5 on Android): ExoPlayer in a
 * media session service, so the notification, the lock screen and Bluetooth controls work and the
 * music keeps playing with the screen off. Streams, covers and the audio tap all go through here.
 * Two players take turns for crossfades ([Crossfader]); the session follows the one playing.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
  private var session: MediaSession? = null
  private var crossfader: Crossfader? = null
  private val scope = MainScope()

  override fun onCreate() {
    super.onCreate()
    KaraokeMix.level = echo.prefs.state.value.vocalLevel // before the app's UI (Karaoke) is up
    val http = OkHttpDataSource.Factory(echo.api.http)
    val attributes = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()
    // One audio session for both players, so the equalizer covers a crossfade's two songs.
    val audioSession = runCatching { Util.generateAudioSessionIdV21(this) }.getOrDefault(C.AUDIO_SESSION_ID_UNSET)
    fun build(index: Int): ExoPlayer {
      // Karaoke files (5.1) are mixed back to stereo at the vocals level; then decoded PCM is
      // copied to the Stage's feature analyser (the main player's only) before it reaches the speaker.
      val renderers =
        object : DefaultRenderersFactory(this) {
          override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
            DefaultAudioSink.Builder(context).setAudioProcessors(arrayOf(VocalMixProcessor(), TeeAudioProcessor(Crossfader.tap(index)))).build()
        }
      val p =
        ExoPlayer.Builder(this, renderers)
          .setMediaSourceFactory(DefaultMediaSourceFactory(http))
          .setAudioAttributes(attributes, true)
          .setHandleAudioBecomingNoisy(true)
          .setWakeMode(C.WAKE_MODE_NETWORK)
          .build()
      if (audioSession != C.AUDIO_SESSION_ID_UNSET) p.audioSessionId = audioSession
      return p
    }
    val fader = Crossfader(attributes, ::build)
    crossfader = fader
    val s =
      MediaSession.Builder(this, fader.player)
        .setBitmapLoader(DataSourceBitmapLoader.Builder(this).setDataSourceFactory(http).build())
        .build()
    session = s
    fader.onSwap = { s.player = it }
    // The equalizer, crossfade and key from this device's settings, now and as they change.
    Effects.attach(if (audioSession != C.AUDIO_SESSION_ID_UNSET) audioSession else fader.player.audioSessionId)
    scope.launch { echo.prefs.state.collect { Effects.apply(it, fader) } }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session

  /** Swiped away from recents while paused: nothing is playing, so the service goes too. */
  override fun onTaskRemoved(rootIntent: android.content.Intent?) {
    val p = session?.player
    if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    scope.cancel()
    Effects.release()
    session?.release()
    crossfader?.release()
    session = null
    crossfader = null
    super.onDestroy()
  }
}
