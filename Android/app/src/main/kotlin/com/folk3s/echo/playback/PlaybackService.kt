package com.folk3s.echo.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
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

/**
 * Playback that outlives the activity (PLAYBACK_ARCHITECTURE.md §5 on Android): ExoPlayer in a
 * media session service, so the notification, the lock screen and Bluetooth controls work and the
 * music keeps playing with the screen off. Streams, covers and the audio tap all go through here.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
  private var session: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    val http = OkHttpDataSource.Factory(echo.api.http)
    // Decoded PCM is copied to the Stage's feature analyser before it reaches the speaker.
    val renderers =
      object : DefaultRenderersFactory(this) {
        override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
          DefaultAudioSink.Builder(context).setAudioProcessors(arrayOf(TeeAudioProcessor(AudioTap))).build()
      }
    val player =
      ExoPlayer.Builder(this, renderers)
        .setMediaSourceFactory(DefaultMediaSourceFactory(http))
        .setAudioAttributes(
          AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
          true,
        )
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .build()
    session =
      MediaSession.Builder(this, player)
        .setBitmapLoader(DataSourceBitmapLoader.Builder(this).setDataSourceFactory(http).build())
        .build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session

  /** Swiped away from recents while paused: nothing is playing, so the service goes too. */
  override fun onTaskRemoved(rootIntent: android.content.Intent?) {
    val p = session?.player
    if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    session?.run {
      player.release()
      release()
    }
    session = null
    super.onDestroy()
  }
}
