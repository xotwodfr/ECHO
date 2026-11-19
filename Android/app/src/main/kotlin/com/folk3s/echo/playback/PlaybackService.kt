package com.folk3s.echo.playback

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import com.folk3s.echo.MainActivity
import com.folk3s.echo.echo
import com.folk3s.echo.widget.NowPlayingWidget
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

/**
 * Playback that outlives the activity (PLAYBACK_ARCHITECTURE.md §5 on Android): ExoPlayer in a
 * media session service, so the notification, the lock screen and Bluetooth controls work and the
 * music keeps playing with the screen off. Streams, covers and the audio tap all go through here.
 * A library session (v0.8): Android Auto and other media browsers browse the library ([CarLibrary])
 * and play from it; the home-screen widget ([NowPlayingWidget]) follows the player from here.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {
  private var session: MediaLibrarySession? = null
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var widget: NowPlayingWidget.Updater? = null

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
    val library = CarLibrary(echo, scope)
    // Covers over the authed client, and content:// ones (ArtworkProvider) for the car's sake.
    val bitmaps = DataSourceBitmapLoader.Builder(this).setDataSourceFactory(DefaultDataSource.Factory(this, http)).build()
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val s =
      MediaLibrarySession.Builder(this, player, library)
        .setBitmapLoader(bitmaps)
        .setSessionActivity(open)
        .build()
    session = s
    widget = NowPlayingWidget.Updater(this, bitmaps).also { w ->
      player.addListener(
        object : Player.Listener {
          override fun onEvents(player: Player, events: Player.Events) {
            if (events.containsAny(Player.EVENT_MEDIA_METADATA_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION, Player.EVENT_IS_PLAYING_CHANGED, Player.EVENT_PLAY_WHEN_READY_CHANGED, Player.EVENT_PLAYBACK_STATE_CHANGED, Player.EVENT_TIMELINE_CHANGED)) w.update(player)
          }
        },
      )
    }
    // Signed out: the car forgets this account's lists and shows the sign-in message.
    scope.launch {
      echo.tokens.token.drop(1).collect {
        library.clear()
        s.notifyChildrenChanged(CarId.ROOT, CarTree.root().size, null)
      }
    }
    // Started by the car or the widget with the app closed: the app's player model (scrobbles, the
    // play history, the saved queue) comes up too, as when the app starts it.
    echo.playback
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  /** Swiped away from recents while paused: nothing is playing, so the service goes too. */
  override fun onTaskRemoved(rootIntent: android.content.Intent?) {
    val p = session?.player
    if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    widget?.stopped()
    widget = null
    scope.cancel()
    session?.run {
      player.release()
      release()
    }
    session = null
    super.onDestroy()
  }
}
