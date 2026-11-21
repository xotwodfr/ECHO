package com.folk3s.echo.playback

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.media3.exoplayer.source.ShuffleOrder
import java.nio.ByteBuffer

/**
 * Crossfade on the phone (docs/ANDROID_CLIENT.md, v0.8). ExoPlayer plays one song at a time, so
 * there are two: the main one, which the media session shows, and a spare. [PREPARE_MS] before
 * the fade, the spare gets the same playlist, starting at the next song, paused at volume 0. When
 * the song playing has `seconds` left, the spare starts and the two volumes cross on equal-power
 * curves. When the fade is over the spare becomes the main player ([onSwap] hands it to the media
 * session) and the old one is emptied to be the next spare. Nothing ever seeks or restarts the
 * audio that is heard, so the overlap is seamless.
 *
 * Not between two songs of the same album (they keep their gapless hand-over), not under repeat
 * one, and not when the spare isn't buffered in time. A pause during the fade finishes it on the
 * new song, paused; a seek, a skip or a queue edit during it calls it off.
 *
 * Self-contained: the service builds the players ([make]) and follows [onSwap]; nothing else here
 * knows about the service, so it moves to a MediaLibraryService unchanged.
 */
@OptIn(UnstableApi::class)
class Crossfader(
  private val attributes: AudioAttributes,
  make: (index: Int) -> ExoPlayer,
) {
  private val players = arrayOf(make(0), make(1))

  val player: ExoPlayer get() = players[heard]
  private val spare: ExoPlayer get() = players[1 - heard]

  /** The new main player after a fade: the service hands it to the media session. */
  var onSwap: (ExoPlayer) -> Unit = {}

  /** Settings → Playback → Crossfade, 0 (off) to 12 s. */
  var seconds = 0

  /** The equalizer's headroom (AudioMath.eqHeadroom), on top of the fade. */
  var gain = 1f
    set(v) {
      field = v
      if (!fading) player.volume = v
    }

  /** Karaoke's key as a pitch ratio, speed unchanged (Sonic in DefaultAudioSink). */
  var pitch = 1f
    set(v) {
      if (field == v) return
      field = v
      for (p in players) p.playbackParameters = PlaybackParameters(1f, v)
    }

  private val handler = Handler(Looper.getMainLooper())
  /** What the spare holds: the hand-over it was prepared for, or null. */
  private var prepared: String? = null
  private var fading = false
  private var fadeStart = 0L
  private var fadeMs = 0L

  private val listener =
    object : Player.Listener {
      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        // Paused mid-fade: the new song is what's left, paused.
        if (fading && !playWhenReady) finish(paused = true)
        if (playWhenReady) wake()
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        if (!fading) return dropSpare()
        // The old song reached its end a moment before the fade did: finish now.
        if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) finish(paused = false) else cancel()
      }

      override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int) {
        if (reason == Player.DISCONTINUITY_REASON_SEEK && fading) cancel()
      }

      override fun onTimelineChanged(timeline: Timeline, reason: Int) {
        if (reason != Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) return
        if (fading) cancel() else dropSpare()
      }

      override fun onRepeatModeChanged(repeatMode: Int) = dropSpareUnlessFading()

      override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) = dropSpareUnlessFading()
    }

  /** Whether [tick] is scheduled: it runs while something plays or fades, and sleeps otherwise. */
  private var ticking = false
  private val tick =
    object : Runnable {
      override fun run() {
        runCatching { step() }
        ticking = fading || player.playWhenReady
        if (ticking) handler.postDelayed(this, if (fading) 40L else 250L)
      }
    }

  private fun wake() {
    if (ticking) return
    ticking = true
    handler.post(tick)
  }

  init {
    heard = 0
    players[1].setAudioAttributes(attributes, false)
    player.addListener(listener)
    wake()
  }

  private fun step() {
    val p = player
    if (fading) {
      val t = ((SystemClock.elapsedRealtime() - fadeStart).toFloat() / fadeMs).coerceIn(0f, 1f)
      p.volume = gain * AudioMath.fadeOut(t)
      spare.volume = gain * AudioMath.fadeIn(t)
      if (t >= 1f) finish(paused = false)
      return
    }
    if (seconds <= 0 || !p.playWhenReady || p.repeatMode == Player.REPEAT_MODE_ONE) return dropSpare()
    val next = p.nextMediaItemIndex
    val cur = p.currentMediaItem
    val duration = p.duration
    if (next == C.INDEX_UNSET || cur == null || duration == C.TIME_UNSET || duration <= 0) return dropSpare()
    val nextItem = p.getMediaItemAt(next)
    if (!AudioMath.crossfadeBetween(albumOf(cur), albumOf(nextItem), cur.mediaId, nextItem.mediaId)) return dropSpare()
    val left = duration - p.currentPosition
    val fade = seconds * 1000L
    val key = "${p.currentMediaItemIndex}>$next:${nextItem.mediaId}/${p.mediaItemCount}/${p.shuffleModeEnabled}"
    if (left <= fade + PREPARE_MS && prepared != key) prepare(p, next, key)
    // Started only with the spare ready: otherwise the ordinary gapless hand-over at the end.
    if (prepared == key && p.isPlaying && left in 400..fade && spare.playbackState == Player.STATE_READY) start(left - 120)
  }

  /** The spare gets the same playlist, at the next song, paused and silent. */
  private fun prepare(p: ExoPlayer, next: Int, key: String) {
    val s = spare
    s.volume = 0f
    s.playWhenReady = false
    s.setMediaItems(List(p.mediaItemCount) { p.getMediaItemAt(it) }, next, 0)
    s.repeatMode = p.repeatMode
    s.shuffleModeEnabled = p.shuffleModeEnabled
    if (p.shuffleModeEnabled) s.setShuffleOrder(shuffleOrderOf(p.currentTimeline))
    s.playbackParameters = p.playbackParameters
    s.prepare()
    prepared = key
  }

  private fun start(ms: Long) {
    fading = true
    fadeStart = SystemClock.elapsedRealtime()
    fadeMs = ms.coerceAtLeast(200)
    spare.play()
  }

  /** The fade is over: the spare is the main player now, and the old one empties. */
  private fun finish(paused: Boolean) {
    fading = false
    prepared = null
    val old = player
    old.removeListener(listener)
    heard = 1 - heard
    val now = player
    now.volume = gain
    // Audio focus moves with the music: the new main asks for it, the old one lets it go.
    now.setAudioAttributes(attributes, true)
    old.setAudioAttributes(attributes, false)
    if (paused) now.pause()
    now.addListener(listener)
    onSwap(now)
    old.playWhenReady = false
    old.stop()
    old.clearMediaItems()
  }

  /** Called off: the spare stops, the song playing goes on at full volume. */
  private fun cancel() {
    fading = false
    dropSpare()
    player.volume = gain
  }

  private fun dropSpareUnlessFading() {
    if (!fading) dropSpare()
  }

  private fun dropSpare() {
    if (prepared == null) return
    prepared = null
    val s = spare
    s.playWhenReady = false
    s.stop()
    s.clearMediaItems()
  }

  fun release() {
    handler.removeCallbacks(tick)
    for (p in players) p.release()
  }

  companion object {
    /** Which player is the main one (the session's); the taps read it too, built before the Crossfader. */
    @Volatile private var heard = 0

    /** The audio tap (AudioTap) for player [index]: only the main player's audio reaches it. */
    fun tap(index: Int): TeeAudioProcessor.AudioBufferSink =
      object : TeeAudioProcessor.AudioBufferSink {
        private var format: IntArray? = null
        private var forwarded = false

        override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
          format = intArrayOf(sampleRateHz, channelCount, encoding)
          forwarded = heard == index
          if (forwarded) AudioTap.flush(sampleRateHz, channelCount, encoding)
        }

        override fun handleBuffer(buffer: ByteBuffer) {
          if (heard != index) {
            forwarded = false
            return
          }
          val f = format
          if (!forwarded && f != null) AudioTap.flush(f[0], f[1], f[2])
          forwarded = true
          AudioTap.handleBuffer(buffer)
        }
      }

    /** How long before the fade the spare starts buffering the next song. */
    const val PREPARE_MS = 8_000L

    /** The album a queued item belongs to (Playback puts its key in the metadata's extras). */
    fun albumOf(item: MediaItem): String? =
      item.mediaMetadata.extras?.getString(ALBUM_KEY) ?: item.mediaMetadata.albumTitle?.let { "${item.mediaMetadata.artist}/$it" }

    const val ALBUM_KEY = "echo.album"

    /** The main player's shuffled play order, so the spare plays the same songs next. */
    private fun shuffleOrderOf(tl: Timeline): ShuffleOrder {
      val order = IntArray(tl.windowCount)
      var i = tl.getFirstWindowIndex(true)
      var k = 0
      while (i != C.INDEX_UNSET && k < order.size) {
        order[k++] = i
        i = tl.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, true)
      }
      return ShuffleOrder.DefaultShuffleOrder(order, SystemClock.elapsedRealtime())
    }
  }
}
