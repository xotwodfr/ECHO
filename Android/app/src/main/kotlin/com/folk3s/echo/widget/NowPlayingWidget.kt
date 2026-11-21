package com.folk3s.echo.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.widget.RemoteViews
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.Player
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import com.folk3s.echo.MainActivity
import com.folk3s.echo.R
import com.folk3s.echo.echo
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** What the widget shows: the song (null when nothing is queued) and whether it plays. */
data class WidgetState(val title: String? = null, val artist: String? = null, val playing: Boolean = false)

/**
 * The home-screen widget: the cover, the song, previous / play-pause / next; a tap anywhere else
 * opens the app. PlaybackService pushes every change ([Updater]); the buttons go to the app's own
 * player (Playback), which connects to the service if it is not running yet.
 */
class NowPlayingWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    manager.updateAppWidget(ids, views(context, saved(context), cover))
  }

  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action !in ACTIONS) return super.onReceive(context, intent)
    val app = context.echo
    when (action) {
      PREVIOUS -> app.playback.previous()
      TOGGLE -> app.playback.toggle()
      NEXT -> app.playback.next()
    }
    // The command waits for the player's connection: the process stays until it has gone through.
    val pending = goAsync()
    app.scope.launch {
      withTimeoutOrNull(8_000) { app.playback.state.first { it.connected } }
      delay(300)
      pending.finish()
    }
  }

  /** PlaybackService's side: the player's song and state onto every widget, the cover when it changes. */
  @OptIn(UnstableApi::class)
  class Updater(private val context: Context, private val bitmaps: BitmapLoader) {
    private var last: WidgetState? = null
    private var art: Uri? = null

    fun update(player: Player) {
      val md = player.mediaMetadata
      val has = player.mediaItemCount > 0
      val state =
        WidgetState(
          title = if (has) md.title?.toString() ?: md.displayTitle?.toString() else null,
          artist = if (has) md.artist?.toString() else null,
          playing = player.playWhenReady && player.playbackState != Player.STATE_IDLE && player.playbackState != Player.STATE_ENDED,
        )
      val uri = if (has) md.artworkUri else null
      if (uri != art) {
        art = uri
        cover = null
        if (uri != null && ids(context).isNotEmpty()) {
          val f = bitmaps.loadBitmap(uri)
          f.addListener(
            {
              val b = runCatching { f.get() }.getOrNull()
              if (b != null && art == uri) {
                cover = scaled(b)
                push(last ?: state, force = true)
              }
            },
            ContextCompat.getMainExecutor(context),
          )
        }
        push(state, force = true)
      } else push(state)
    }

    /** The service is going: the widget keeps the song, paused. */
    fun stopped() = push((last ?: WidgetState()).copy(playing = false), force = true)

    private fun push(state: WidgetState, force: Boolean = false) {
      if (!force && state == last) return
      last = state
      save(context, state)
      val ids = ids(context)
      if (ids.isEmpty()) return
      AppWidgetManager.getInstance(context).updateAppWidget(ids, views(context, state, cover))
    }
  }

  companion object {
    private const val PREVIOUS = "com.folk3s.echo.widget.PREVIOUS"
    private const val TOGGLE = "com.folk3s.echo.widget.TOGGLE"
    private const val NEXT = "com.folk3s.echo.widget.NEXT"
    private val ACTIONS = setOf(PREVIOUS, TOGGLE, NEXT)
    private const val PREFS = "widget"
    private const val COVER_PX = 256

    /** The current cover, scaled down, for as long as the process lives. */
    @Volatile private var cover: Bitmap? = null

    private fun ids(ctx: Context) = AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, NowPlayingWidget::class.java))

    private fun scaled(b: Bitmap): Bitmap {
      val side = maxOf(b.width, b.height)
      if (side <= COVER_PX) return b
      val k = COVER_PX.toFloat() / side
      return Bitmap.createScaledBitmap(b, (b.width * k).toInt().coerceAtLeast(1), (b.height * k).toInt().coerceAtLeast(1), true)
    }

    /** The last song shown, for a widget drawn while the service is not running. */
    private fun saved(ctx: Context): WidgetState {
      val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return WidgetState(p.getString("title", null), p.getString("artist", null), false)
    }

    private fun save(ctx: Context, s: WidgetState) {
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("title", s.title).putString("artist", s.artist).apply()
    }

    private fun action(ctx: Context, action: String, code: Int): PendingIntent =
      PendingIntent.getBroadcast(
        ctx,
        code,
        Intent(ctx, NowPlayingWidget::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )

    internal fun views(ctx: Context, s: WidgetState, art: Bitmap?): RemoteViews =
      RemoteViews(ctx.packageName, R.layout.widget_now_playing).apply {
        setTextViewText(R.id.widget_title, s.title ?: ctx.getString(R.string.widget_idle_title))
        setTextViewText(R.id.widget_artist, s.artist ?: ctx.getString(R.string.widget_idle_artist))
        if (art != null) setImageViewBitmap(R.id.widget_cover, art) else setImageViewResource(R.id.widget_cover, R.drawable.widget_cover_placeholder)
        setImageViewResource(R.id.widget_toggle, if (s.playing) R.drawable.widget_pause else R.drawable.widget_play)
        setContentDescription(R.id.widget_toggle, ctx.getString(if (s.playing) R.string.widget_pause else R.string.widget_play))
        val open = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        setOnClickPendingIntent(R.id.widget_previous, action(ctx, PREVIOUS, 1))
        setOnClickPendingIntent(R.id.widget_toggle, action(ctx, TOGGLE, 2))
        setOnClickPendingIntent(R.id.widget_next, action(ctx, NEXT, 3))
      }
  }
}
