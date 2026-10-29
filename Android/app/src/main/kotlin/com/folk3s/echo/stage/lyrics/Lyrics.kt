package com.folk3s.echo.stage.lyrics

import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.LyricsAnswer
import com.folk3s.echo.api.LyricsDoc
import com.folk3s.echo.api.Track
import java.net.URLEncoder
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.serialization.json.decodeFromJsonElement

// The lyrics loader (src/client/lyrics/loader.ts; LYRICS_INTEGRATION.md §6): follows the current
// track, asks the server 250 ms after a change, drops answers for any track but the current one,
// gives up at 6 s while still taking a late answer, and warms the server's cache for the next.

enum class LyricsStatus { Idle, Waiting, Ready, Missing }

data class LyricsState(
  val trackKey: String? = null,
  val status: LyricsStatus = LyricsStatus.Idle,
  val doc: LyricsDoc? = null,
  val offsetMs: Long = 0, // the user's offset for this track (`/me/tracks/{key}/override`)
)

private const val DEBOUNCE_MS = 250L
private const val GIVE_UP_MS = 6000L
private const val PREFETCH_MS = 2000L

fun lyricsQuery(t: Track): String {
  fun e(s: String) = URLEncoder.encode(s, "UTF-8")
  val q = "trackKey=${e(t.key)}&title=${e(t.title)}&artist=${e(t.artists.firstOrNull()?.name ?: "")}&album=${e(t.album.title)}&durationMs=${t.durationMs}"
  return "/lyrics?$q${t.isrc?.let { "&isrc=${e(it)}" } ?: ""}"
}

class Lyrics(private val app: EchoApp) {
  private val _state = MutableStateFlow(LyricsState())
  val state: StateFlow<LyricsState> = _state
  private var job: Job? = null

  init {
    app.scope.launch {
      app.playback.state.map { it.track }.distinctUntilChanged { a, b -> a?.key == b?.key }.collect(::start)
    }
  }

  private fun start(track: Track?) {
    job?.cancel()
    if (track == null) {
      _state.value = LyricsState()
      return
    }
    _state.value = LyricsState(track.key, LyricsStatus.Waiting)
    job =
      app.scope.launch {
        launch {
          delay(GIVE_UP_MS)
          if (_state.value.trackKey == track.key && _state.value.status == LyricsStatus.Waiting) _state.value = _state.value.copy(status = LyricsStatus.Missing)
        }
        launch {
          delay(PREFETCH_MS)
          val next = app.playback.state.value.queue.let { (it.nextUp + it.context).firstOrNull() }
          if (next != null && track.durationMs - PREFETCH_MS >= 20_000) runCatching { app.api.get(lyricsQuery(next)) }
        }
        delay(DEBOUNCE_MS)
        val answer =
          try {
            EchoJson.decodeFromJsonElement<LyricsAnswer>(app.api.get(lyricsQuery(track)))
          } catch (e: ApiError) {
            LyricsAnswer(null, null) // 404: no source had them
          } catch (e: java.io.IOException) {
            LyricsAnswer(null, null)
          } catch (e: kotlinx.serialization.SerializationException) {
            LyricsAnswer(null, null)
          }
        // A late answer for a track that is no longer playing is dropped (the server cached it).
        if (_state.value.trackKey != track.key) return@launch
        _state.value = LyricsState(track.key, if (answer.doc != null) LyricsStatus.Ready else LyricsStatus.Missing, answer.doc, answer.override?.offsetMs ?: 0)
      }
  }

  /** `[` / `]` on the web: this track's lyrics ±50 ms, saved per track. */
  fun nudge(direction: Int) {
    val s = _state.value
    val key = s.trackKey ?: return
    if (s.status == LyricsStatus.Waiting) return
    val offset = (s.offsetMs + direction * 50).coerceIn(-10_000, 10_000)
    _state.value = s.copy(offsetMs = offset)
    app.scope.launch {
      delay(500)
      if (_state.value.trackKey != key || _state.value.offsetMs != offset) return@launch
      runCatching {
        app.api.send("PUT", "/me/tracks/${URLEncoder.encode(key, "UTF-8")}/override", kotlinx.serialization.json.buildJsonObject { put("offsetMs", kotlinx.serialization.json.JsonPrimitive(offset)) })
      }
    }
  }
}
