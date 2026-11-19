package com.folk3s.echo.playback

import android.os.SystemClock
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.Track
import java.net.URLEncoder
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** What Karaoke mode can say about the song playing. */
enum class KaraokeStatus { Off, Unavailable, Preparing, Ready, Failed, TooLong, Downmixed }

data class KaraokeState(
  /** Whether the server has a stem service at all (null: not asked yet). */
  val server: Boolean? = null,
  val status: KaraokeStatus = KaraokeStatus.Off,
  /** Songs before this one on the server while it is being prepared. */
  val ahead: Int = 0,
)

/**
 * Karaoke mode on the phone (docs/KARAOKE.md). While it is on, it asks the server for the song
 * playing (made first) and the next two in the queue (made next), and hands each karaoke version to
 * [Playback] once it is ready. The vocals level goes straight to the mixer, so the slider acts at once.
 */
class Karaoke(private val app: EchoApp) {
  private val _state = MutableStateFlow(KaraokeState())
  val state: StateFlow<KaraokeState> = _state
  private val wake = Channel<Unit>(Channel.CONFLATED)
  /** When each song was last asked about (track key → elapsedRealtime), so polling stays slow. */
  private val asked = HashMap<String, Long>()
  /** Songs the server answered for for good (ready, failed or too long). */
  private val settled = HashMap<String, String>()
  private var karaokeSince = 0L
  private var warnedDownmix = false
  /** Seen once: this phone's decoder downmixes 5.1, so karaoke files keep their voice. */
  private var downmixed = false

  init {
    app.scope.launch {
      app.prefs.state.map { it.vocalLevel }.distinctUntilChanged().collect { KaraokeMix.level = it }
    }
    app.scope.launch {
      app.prefs.state.map { it.karaoke }.distinctUntilChanged().collect {
        app.playback.refreshSources()
        wake.trySend(Unit)
      }
    }
    app.scope.launch {
      app.playback.state.map { it.track?.key }.distinctUntilChanged().collect {
        karaokeSince = 0L
        wake.trySend(Unit)
      }
    }
    app.scope.launch { loop() }
  }

  fun setOn(on: Boolean) = app.prefs.update { it.copy(karaoke = on) }

  /**
   * A song's menu → Make karaoke version: the server makes it next (ahead of the library), and
   * says so in a notice.
   */
  fun request(t: Track) {
    if (t.provider != "navidrome") return app.playback.notify("Karaoke works with songs from your library.")
    app.scope.launch {
      val o = runCatching { app.api.get("/karaoke/${URLEncoder.encode(t.id, "UTF-8")}").jsonObject }.getOrNull()
      val st = o?.get("status")?.jsonPrimitive?.contentOrNull
      val ahead = o?.get("ahead")?.jsonPrimitive?.intOrNull ?: 0
      if (st == "ready") o?.get("url")?.jsonPrimitive?.contentOrNull?.let { app.playback.karaokeReady(t.key, it) }
      app.playback.notify(
        when (st) {
          "ready" -> "The karaoke version of “${t.title}” is ready."
          "queued", "working" ->
            if (ahead == 0) "Making the karaoke version of “${t.title}” now: a few minutes."
            else "“${t.title}” is next in line for karaoke: $ahead ${if (ahead == 1) "song" else "songs"} before it."
          "failed" -> "The voice couldn't be taken out of “${t.title}”."
          "skipped" -> "“${t.title}” is too long for Karaoke."
          "off" -> "Karaoke isn't set up on your ECHO server yet."
          else -> "Couldn't reach ECHO. Try again in a moment."
        },
      )
    }
  }

  fun setLevel(level: Float) = app.prefs.update { it.copy(vocalLevel = level.coerceIn(0f, 1f)) }

  /** Karaoke's key in semitones (the playback service applies it while Karaoke is on). */
  fun setKey(semitones: Int) {
    val n = semitones.coerceIn(-AudioMath.KEY_RANGE, AudioMath.KEY_RANGE)
    if (n != app.prefs.state.value.karaokeKey) app.prefs.update { it.copy(karaokeKey = n) }
  }

  /** Signed out: another account's server knows other songs. */
  fun clear() {
    asked.clear()
    settled.clear()
    _state.value = KaraokeState()
  }

  private suspend fun loop() {
    while (true) {
      runCatching { tick() }
      withTimeoutOrNull(3000) { wake.receive() }
    }
  }

  private suspend fun tick() {
    if (app.tokens.token.value == null) return
    val on = app.prefs.state.value.karaoke
    val s = app.playback.state.value
    val t = s.track
    if (!on || t == null) {
      _state.value = _state.value.copy(status = KaraokeStatus.Off)
      return
    }
    if (_state.value.server == null) {
      val enabled = runCatching { app.api.get("/karaoke").jsonObject["enabled"]?.jsonPrimitive?.contentOrNull == "true" }.getOrNull()
      if (enabled == null) return
      _state.value = _state.value.copy(server = enabled)
    }
    if (_state.value.server == false || t.provider != "navidrome") {
      _state.value = _state.value.copy(status = KaraokeStatus.Unavailable)
      return
    }
    // The song playing: every 5 s until it is ready.
    checkDownmix()
    val status = ask(t.key, t.id, soon = false, every = 5_000)
    if (status != null) {
      val st = if (status.first == KaraokeStatus.Ready && downmixed) KaraokeStatus.Downmixed else status.first
      _state.value = _state.value.copy(status = st, ahead = status.second)
    }
    // The next two: once a minute each, so they are ready when they start.
    for (n in (s.queue.nextUp + s.queue.context).take(2)) if (n.provider == "navidrome") ask(n.key, n.id, soon = true, every = 60_000)
  }

  /** Asks the server about a song (at most every [every] ms); null when it was not asked now. */
  private suspend fun ask(key: String, id: String, soon: Boolean, every: Long): Pair<KaraokeStatus, Int>? {
    settled[key]?.let { return statusOf(it) to 0 }
    val now = SystemClock.elapsedRealtime()
    if ((asked[key] ?: Long.MIN_VALUE / 2) + every > now) return null
    asked[key] = now
    val path = "/karaoke/${URLEncoder.encode(id, "UTF-8")}" + if (soon) "?soon=1" else ""
    val o = app.api.get(path).jsonObject
    val st = o["status"]?.jsonPrimitive?.contentOrNull ?: return null
    if (st == "ready") o["url"]?.jsonPrimitive?.contentOrNull?.let { app.playback.karaokeReady(key, it) }
    if (st == "ready" || st == "failed" || st == "skipped") settled[key] = st
    if (st == "off") _state.value = _state.value.copy(server = false)
    return statusOf(st) to (o["ahead"]?.jsonPrimitive?.intOrNull ?: 0)
  }

  private fun statusOf(s: String) =
    when (s) {
      "ready" -> KaraokeStatus.Ready
      "failed" -> KaraokeStatus.Failed
      "skipped" -> KaraokeStatus.TooLong
      "off" -> KaraokeStatus.Unavailable
      else -> KaraokeStatus.Preparing
    }

  /** A karaoke file the decoder handed over as stereo: this phone mixes 5.1 down itself. */
  private fun checkDownmix() {
    val p = app.playback
    if (!p.playingKaraoke() || !p.state.value.playing) {
      karaokeSince = 0L
      return
    }
    val now = SystemClock.elapsedRealtime()
    if (karaokeSince == 0L) karaokeSince = now
    if (now - karaokeSince < 2_000 || KaraokeMix.inputChannels != 2) return
    downmixed = true
    if (!warnedDownmix) {
      warnedDownmix = true
      p.notify("This phone mixes 5.1 audio down to stereo, so Karaoke can't take the voice out here.")
    }
  }
}
