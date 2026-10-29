package com.folk3s.echo.playback

import android.content.ComponentName
import android.net.Uri
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.QueueState
import com.folk3s.echo.api.Track
import java.net.URLEncoder
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

enum class Repeat { Off, All, One }

/** The queue as the web shows it (QueueState): what played, what plays, what was added, the rest. */
data class QueueView(
  val history: List<Track> = emptyList(),
  val now: Track? = null,
  val nextUp: List<Track> = emptyList(),
  val context: List<Track> = emptyList(),
  val source: PlayContext? = null,
)

data class PlayerState(
  val connected: Boolean = false,
  val track: Track? = null,
  val playing: Boolean = false,
  val buffering: Boolean = false,
  val positionMs: Long = 0,
  val positionAt: Long = 0, // elapsedRealtime at the observation
  val durationMs: Long = 0,
  val shuffle: Boolean = false,
  val repeat: Repeat = Repeat.Off,
  val queue: QueueView = QueueView(),
  val notice: String? = null,
) {
  /** Where playback is now, extrapolated from the last observation while playing. */
  fun positionNow(now: Long = SystemClock.elapsedRealtime()): Long =
    if (playing && !buffering) (positionMs + now - positionAt).coerceAtMost(durationMs.takeIf { it > 0 } ?: Long.MAX_VALUE)
    else positionMs
}

private const val SCROBBLE_MS = 4 * 60_000L
private const val SAVE_DEBOUNCE_MS = 2000L
private const val SAVE_EVERY_MS = 15_000L
private const val HISTORY = 50

/** The saved queue's position: any JSON number, as the web writes a fraction of a ms (QueueTest). */
internal fun savedPositionMs(saved: JsonObject): Long = saved["positionMs"]?.jsonPrimitive?.doubleOrNull?.toLong() ?: 0

/**
 * The player as the app sees it (src/client/playback/controller.ts on Android): a MediaController
 * on [PlaybackService]'s session, the queue model on top of ExoPlayer's playlist, scrobbles, and the
 * queue that follows the user across devices (queueSync.ts).
 */
class Playback(private val app: EchoApp) {
  private val _state = MutableStateFlow(PlayerState())
  val state: StateFlow<PlayerState> = _state

  private var c: MediaController? = null
  private val pending = mutableListOf<(MediaController) -> Unit>()
  private val tracks = HashMap<String, Track>()
  private var nextUp = 0 // items right after the current one that the user added
  private var source: PlayContext? = null
  private var lastIndex = -1
  private var scrobbled = "none"
  private var queueBase = 0L
  private var saveJob: Job? = null

  init {
    val token = SessionToken(app, ComponentName(app, PlaybackService::class.java))
    val future = MediaController.Builder(app, token).buildAsync()
    future.addListener(
      {
        val mc = future.get()
        c = mc
        mc.addListener(listener)
        pending.forEach { it(mc) }
        pending.clear()
        publish()
        app.scope.launch { restoreQueue() }
      },
      ContextCompat.getMainExecutor(app),
    )
    app.scope.launch { ticker() }
  }

  private fun run(block: (MediaController) -> Unit) {
    val mc = c
    if (mc != null) block(mc) else pending += block
  }

  private fun item(t: Track): MediaItem {
    tracks[t.key] = t
    val id = URLEncoder.encode(t.id, "UTF-8")
    return MediaItem.Builder()
      .setMediaId(t.key)
      .setUri(app.api.url("/api/v1/navidrome/stream/$id?format=raw"))
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(t.title)
          .setArtist(t.artist)
          .setAlbumTitle(t.album.title)
          .setArtworkUri(t.cover?.let { Uri.parse(app.api.url(it)) })
          .setDurationMs(t.durationMs.takeIf { it > 0 })
          .build(),
      )
      .build()
  }

  // ---- commands ----

  fun playList(list: List<Track>, index: Int, ctx: PlayContext) {
    if (list.isEmpty()) return
    run { mc ->
      nextUp = 0
      source = ctx
      mc.setMediaItems(list.map(::item), index.coerceIn(0, list.lastIndex), 0)
      mc.prepare()
      mc.play()
    }
  }

  fun toggle() = run { mc ->
    when {
      mc.isPlaying -> mc.pause()
      mc.playbackState == Player.STATE_ENDED -> {
        mc.seekToDefaultPosition(0)
        mc.play()
      }
      else -> {
        if (mc.playbackState == Player.STATE_IDLE) mc.prepare()
        mc.play()
      }
    }
  }

  fun next() = run { if (it.hasNextMediaItem()) it.seekToNextMediaItem() }

  /** Restart past 3 s, else the track before (the web's Previous). */
  fun previous() = run { it.seekToPrevious() }

  fun seek(ms: Long) = run { it.seekTo(ms.coerceAtLeast(0)) }

  fun toggleShuffle() = run { it.shuffleModeEnabled = !it.shuffleModeEnabled }

  fun cycleRepeat() = run {
    it.repeatMode =
      when (it.repeatMode) {
        Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
        Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
      }
  }

  /** "Play next" goes first in Next up; "Add to queue" goes last (QueueState.nextUp). */
  fun playNext(t: Track) = enqueue(t, first = true)

  fun addToQueue(t: Track) = enqueue(t, first = false)

  private fun enqueue(t: Track, first: Boolean) = run { mc ->
    if (mc.mediaItemCount == 0) return@run playList(listOf(t), 0, PlayContext("search", title = t.title))
    val at = mc.currentMediaItemIndex + 1 + if (first) 0 else nextUp
    mc.addMediaItem(at.coerceAtMost(mc.mediaItemCount), item(t))
    nextUp++
    note(if (first) "Playing “${t.title}” next" else "Added “${t.title}” to the queue")
  }

  /** `upcoming`: an index into [QueueView.nextUp] + [QueueView.context] in their shown order. */
  fun removeUpcoming(upcoming: Int) = run { mc ->
    val i = upcomingIndices(mc).getOrNull(upcoming) ?: return@run
    if (upcoming < nextUp) nextUp--
    mc.removeMediaItem(i)
  }

  fun moveUpcoming(from: Int, to: Int) = run { mc ->
    val order = upcomingIndices(mc)
    val a = order.getOrNull(from) ?: return@run
    val b = order.getOrNull(to) ?: return@run
    mc.moveMediaItem(a, b)
  }

  fun jumpTo(upcoming: Int) = run { mc ->
    val i = upcomingIndices(mc).getOrNull(upcoming) ?: return@run
    nextUp = (nextUp - upcoming - 1).coerceAtLeast(0)
    mc.seekToDefaultPosition(i)
    mc.play()
  }

  /** Clear queue: everything after what plays goes; it keeps playing. */
  fun clearUpcoming() = run { mc ->
    for (i in upcomingIndices(mc).sortedDescending()) mc.removeMediaItem(i)
    nextUp = 0
  }

  /** Signed out: the next account must not get this queue (REL-05). */
  fun reset() = run { mc ->
    mc.stop()
    mc.clearMediaItems()
    tracks.clear()
    nextUp = 0
    source = null
    queueBase = 0
  }

  fun dismissNotice() {
    _state.value = _state.value.copy(notice = null)
  }

  private fun note(msg: String) {
    _state.value = _state.value.copy(notice = msg)
  }

  // ---- state ----

  /** Playlist indices after the current one, in play order (shuffle included). */
  private fun upcomingIndices(mc: Player): List<Int> {
    val tl = mc.currentTimeline
    if (tl.isEmpty || mc.currentMediaItemIndex == C.INDEX_UNSET) return emptyList()
    val out = mutableListOf<Int>()
    var i = tl.getNextWindowIndex(mc.currentMediaItemIndex, Player.REPEAT_MODE_OFF, mc.shuffleModeEnabled)
    while (i != C.INDEX_UNSET && out.size < tl.windowCount) {
      out += i
      i = tl.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, mc.shuffleModeEnabled)
    }
    return out
  }

  private fun historyIndices(mc: Player): List<Int> {
    val tl = mc.currentTimeline
    if (tl.isEmpty || mc.currentMediaItemIndex == C.INDEX_UNSET) return emptyList()
    val out = mutableListOf<Int>()
    var i = tl.getPreviousWindowIndex(mc.currentMediaItemIndex, Player.REPEAT_MODE_OFF, mc.shuffleModeEnabled)
    while (i != C.INDEX_UNSET && out.size < HISTORY) {
      out += i
      i = tl.getPreviousWindowIndex(i, Player.REPEAT_MODE_OFF, mc.shuffleModeEnabled)
    }
    return out.reversed()
  }

  private fun trackAt(mc: Player, i: Int) = tracks[mc.getMediaItemAt(i).mediaId]

  private fun publish() {
    val mc = c ?: return
    val index = mc.currentMediaItemIndex
    if (lastIndex >= 0 && index != lastIndex && index != C.INDEX_UNSET) {
      // Moving into Next up uses it up; scrobbling starts over for the new track.
      nextUp = (nextUp - (index - lastIndex).coerceAtLeast(0)).coerceAtLeast(0)
      scrobbled = "none"
    }
    lastIndex = index
    val up = upcomingIndices(mc).mapNotNull { trackAt(mc, it) }
    val now = if (mc.mediaItemCount > 0 && index != C.INDEX_UNSET) trackAt(mc, index) else null
    _state.value =
      _state.value.copy(
        connected = true,
        track = now,
        playing = mc.playWhenReady && mc.playbackState != Player.STATE_ENDED && mc.playbackState != Player.STATE_IDLE,
        buffering = mc.playbackState == Player.STATE_BUFFERING,
        positionMs = mc.currentPosition,
        positionAt = SystemClock.elapsedRealtime(),
        durationMs = mc.duration.takeIf { it != C.TIME_UNSET } ?: (now?.durationMs ?: 0),
        shuffle = mc.shuffleModeEnabled,
        repeat =
          when (mc.repeatMode) {
            Player.REPEAT_MODE_ALL -> Repeat.All
            Player.REPEAT_MODE_ONE -> Repeat.One
            else -> Repeat.Off
          },
        queue =
          QueueView(
            history = historyIndices(mc).mapNotNull { trackAt(mc, it) },
            now = now,
            nextUp = up.take(nextUp),
            context = up.drop(nextUp),
            source = source,
          ),
      )
  }

  private val listener =
    object : Player.Listener {
      override fun onEvents(player: Player, events: Player.Events) {
        val before = _state.value
        publish()
        val after = _state.value
        val jumped = kotlin.math.abs(after.positionNow() - before.positionNow()) > 2000
        if (
          events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION) ||
            before.playing != after.playing || jumped
        ) saveLater()
      }

      override fun onPlayerError(error: PlaybackException) {
        val mc = c ?: return
        // A track that cannot be played is skipped, like the web (REL-02's last resort).
        if (mc.hasNextMediaItem()) {
          note("This track could not be played. Skipped to the next.")
          mc.seekToNextMediaItem()
          mc.prepare()
          mc.play()
        } else note("This track could not be played.")
      }
    }

  /** Once a second: the state's position, scrobbles (half the track or 4 min), the periodic save. */
  private suspend fun ticker() {
    var sinceSave = 0L
    while (kotlin.coroutines.coroutineContext.isActive) {
      delay(1000)
      val s = _state.value
      val t = s.track ?: continue
      if (!s.playing) continue
      publish()
      scrobble(t, _state.value.positionNow())
      sinceSave += 1000
      if (sinceSave >= SAVE_EVERY_MS) {
        sinceSave = 0
        saveLater()
      }
    }
  }

  private fun scrobble(t: Track, at: Long) {
    if (!app.prefs.state.value.scrobble) return
    fun post(submission: Boolean) =
      app.scope.launch {
        runCatching { app.api.send("POST", "/navidrome/rest/scrobble?id=${URLEncoder.encode(t.id, "UTF-8")}&submission=$submission") }
      }
    if (scrobbled == "none") {
      scrobbled = "now"
      post(false)
    }
    if (scrobbled == "now" && (at >= t.durationMs / 2 || at >= SCROBBLE_MS)) {
      scrobbled = "done"
      post(true)
    }
  }

  // ---- the saved queue (queueSync.ts) ----

  private suspend fun restoreQueue() {
    if (app.tokens.token.value == null) return
    val saved = runCatching { app.api.get("/me/queue").jsonObject }.getOrNull() ?: return
    queueBase = saved["updatedAt"]?.jsonPrimitive?.long ?: 0
    val q = saved["queue"]?.let { runCatching { EchoJson.decodeFromJsonElement<QueueState>(it) }.getOrNull() } ?: return
    if (q.now == null || q.provider == "spotify" || (c?.mediaItemCount ?: 0) > 0) return
    restore(q, savedPositionMs(saved))
  }

  private fun restore(q: QueueState, positionMs: Long) = run { mc ->
    val now = q.now ?: return@run
    val list = q.history + now + q.nextUp + q.context
    nextUp = q.nextUp.size
    source = q.contextSource
    mc.setMediaItems(list.map(::item), q.history.size, positionMs)
    mc.prepare()
  }

  private fun saveLater() {
    saveJob?.cancel()
    saveJob =
      app.scope.launch {
        delay(SAVE_DEBOUNCE_MS)
        save()
      }
  }

  private suspend fun save() {
    if (app.tokens.token.value == null) return
    val s = _state.value
    val q = s.queue
    val body =
      buildJsonObject {
        put(
          "queue",
          if (q.now == null) kotlinx.serialization.json.JsonNull
          else EchoJson.encodeToJsonElement(QueueState("navidrome", q.now, q.nextUp, q.context, q.source, q.history.takeLast(20))),
        )
        put("positionMs", s.positionNow())
        put("baseUpdatedAt", queueBase)
      }
    try {
      queueBase = (app.api.send("PUT", "/me/queue", body) as JsonObject)["updatedAt"]?.jsonPrimitive?.long ?: queueBase
    } catch (e: ApiError) {
      if (e.status != 409) return
      // Another device changed the queue: the one that is playing keeps its own.
      note("Your queue changed on another device.")
      val newer = runCatching { app.api.get("/me/queue").jsonObject }.getOrNull() ?: return
      queueBase = newer["updatedAt"]?.jsonPrimitive?.long ?: queueBase
      val nq = newer["queue"]?.let { runCatching { EchoJson.decodeFromJsonElement<QueueState>(it) }.getOrNull() }
      if (!s.playing && nq?.now != null) restore(nq, savedPositionMs(newer))
    } catch (_: java.io.IOException) {}
  }
}
