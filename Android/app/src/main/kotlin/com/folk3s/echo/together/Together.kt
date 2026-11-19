package com.folk3s.echo.together

import android.os.SystemClock
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.EchoJsonFull
import com.folk3s.echo.api.PlayContext
import com.folk3s.echo.api.Track
import com.folk3s.echo.api.TrackRef
import com.folk3s.echo.playback.RemoteQueue
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okhttp3.Request

// Listen together on Android (docs/TOGETHER.md; src/server/together.ts): join a session from its QR
// code or link, or start one from Now Playing. While in one, the player follows the session's song
// and position (Sync.kt) and its commands go to the session (Playback.remote). Updates arrive as
// Server-Sent Events over OkHttp, with polling as the fallback and the clock's round-trip samples.

@Serializable data class Person(val id: Long, val username: String)

@Serializable data class TogetherItem(val uid: String, val track: TrackRef, val addedBy: Person)

@Serializable data class You(val id: Long, val host: Boolean, val member: Boolean)

@Serializable data class Member(val id: Long, val username: String, val host: Boolean = false, val online: Boolean = true)

@Serializable
data class TogetherState(
  val id: String,
  val url: String,
  val host: Person,
  val you: You,
  val members: List<Member> = emptyList(),
  val now: TogetherItem? = null,
  val queue: List<TogetherItem> = emptyList(),
  val playing: Boolean = false,
  val startedAt: Long? = null,
  val positionMs: Long = 0,
  val serverTime: Long,
  val version: Long = 0,
)

/** A link or scan, before joining: whose session, or why it can't be joined. */
sealed interface Offer {
  val id: String
  data class Loading(override val id: String) : Offer
  data class Ready(override val id: String, val host: String, val members: Int) : Offer
  data class OtherLibrary(override val id: String, val host: String) : Offer
  data class Gone(override val id: String) : Offer
  data class Failed(override val id: String) : Offer
}

private const val TICK_MS = 500L
private const val POLL_MS = 5000L
private const val POLL_FALLBACK_MS = 1000L
private val CONTEXT = PlayContext("together", title = "Listening together")

/** A song as the server keeps it (TrackRef). */
fun Track.ref() = TrackRef(id, title, artist, artists.firstOrNull()?.id, album.title, album.id, durationMs, cover)

class Together(private val app: EchoApp) {
  private val _session = MutableStateFlow<TogetherState?>(null)
  val session: StateFlow<TogetherState?> = _session
  private val _offer = MutableStateFlow<Offer?>(null)
  val offer: StateFlow<Offer?> = _offer
  /** The sheet (code, listeners, the shared queue) is open. */
  val sheetOpen = MutableStateFlow(false)
  val scanning = MutableStateFlow(false)

  private val clock = ClockSync()
  private var loops: List<Job> = emptyList()
  private var streamOpen = false
  private var settleUntil = 0L
  private var cue: Pair<String, Job>? = null

  private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

  private fun decode(e: JsonElement): TogetherState = EchoJson.decodeFromJsonElement(e)

  private suspend fun fetch(id: String): TogetherState {
    val sent = System.currentTimeMillis()
    val s = decode(app.api.get("/together/${enc(id)}"))
    clock.request(s.serverTime, sent, System.currentTimeMillis())
    return s
  }

  private fun apply(s: TogetherState) {
    val cur = _session.value
    if (cur != null && cur.id == s.id && s.version < cur.version) return
    _session.value = s
    follow()
  }

  /** One step of following: compare the player with the session and correct it. */
  private fun follow() {
    val s = _session.value ?: return
    val p = app.playback.state.value
    val track = s.now?.track
    val now = System.currentTimeMillis()
    val target =
      Target(
        trackId = track?.id,
        playing = s.playing,
        durationMs = track?.durationMs ?: 0,
        positionMs = if (track == null) 0 else expectedPosition(s.playing, s.startedAt, s.positionMs, s.serverTime, track.durationMs, clock.toServer(now)),
      )
    val c = cue
    if (c != null && c.first == target.trackId && target.playing) return
    val step =
      plan(
        target,
        Local(
          trackId = p.track?.takeIf { it.provider == "navidrome" }?.id,
          active = p.playing,
          loading = p.buffering,
          positionMs = p.positionNow(SystemClock.elapsedRealtime()),
        ),
        settling = now < settleUntil,
      ) ?: return
    settleUntil = now + SETTLE_MS
    cue?.second?.cancel()
    cue = null
    val pb = app.playback
    if ((step is Step.Load || step is Step.Seek) && track != null && target.playing) {
      val wanted = if (step is Step.Load) step.positionMs else (step as Step.Seek).positionMs
      val (at, wait) = cuePoint(wanted, track.durationMs)
      if (step is Step.Load) pb.follow(track.toTrack(), at, wait == 0L, CONTEXT)
      else {
        if (wait > 0) pb.followPause()
        pb.followSeek(at)
      }
      if (wait > 0) {
        val id = track.id
        cue = id to app.scope.launch {
          delay(wait)
          cue = null
          val cur = _session.value
          if (cur?.now?.track?.id == id && cur.playing) pb.followPlay()
        }
        settleUntil = now + wait + SETTLE_MS
      }
      return
    }
    when (step) {
      is Step.Load -> track?.let { pb.follow(it.toTrack(), step.positionMs, step.play, CONTEXT) }
      is Step.Seek -> pb.followSeek(step.positionMs)
      Step.Play -> pb.followPlay()
      is Step.Pause -> {
        pb.followPause()
        pb.followSeek(step.positionMs)
      }
      Step.Stop -> pb.followPause()
    }
  }

  // ---- the server's events, and polling ----

  private suspend fun events(id: String) {
    while (kotlin.coroutines.coroutineContext.isActive && _session.value?.id == id) {
      val ended =
        withContext(Dispatchers.IO) {
          runCatching {
            val req = Request.Builder().url(app.api.url("/api/v1/together/${enc(id)}/events")).header("Accept", "text/event-stream").build()
            app.api.http.newBuilder().readTimeout(java.time.Duration.ofSeconds(40)).build().newCall(req).execute().use { res ->
              if (res.code == 403 || res.code == 404) return@runCatching true
              if (!res.isSuccessful) return@runCatching false
              streamOpen = true
              val src = res.body.source()
              var event = "message"
              val data = StringBuilder()
              while (!src.exhausted()) {
                val line = src.readUtf8Line() ?: break
                when {
                  line.isEmpty() -> {
                    val text = data.toString()
                    data.clear()
                    val received = System.currentTimeMillis()
                    val gone = withContext(Dispatchers.Main) { onEvent(event, text, received) }
                    if (gone) return@runCatching true
                    event = "message"
                  }
                  line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                  line.startsWith("data:") -> data.append(if (data.isEmpty()) "" else "\n").append(line.removePrefix("data:").trimStart())
                }
              }
              false
            }
          }.getOrDefault(false)
        }
      streamOpen = false
      if (ended) return detach(ended = true)
      delay(3000)
    }
  }

  /** True when the session ended (or this user left it). */
  private fun onEvent(event: String, data: String, received: Long): Boolean {
    when (event) {
      "state" -> {
        val s = runCatching { decode(EchoJson.parseToJsonElement(data)) }.getOrNull() ?: return false
        clock.pushed(s.serverTime, received)
        apply(s)
      }
      "ping" -> runCatching { EchoJson.parseToJsonElement(data).jsonObject["serverTime"]!!.jsonPrimitive.long }.getOrNull()?.let { clock.pushed(it, received) }
      "end" -> return true
    }
    return false
  }

  private suspend fun poll(id: String) {
    while (kotlin.coroutines.coroutineContext.isActive && _session.value?.id == id) {
      delay(if (streamOpen) POLL_MS else POLL_FALLBACK_MS)
      try {
        apply(fetch(id))
      } catch (e: ApiError) {
        if (e.status == 403 || e.status == 404) return detach(ended = true)
      } catch (_: java.io.IOException) {}
    }
  }

  private suspend fun ticker() {
    while (kotlin.coroutines.coroutineContext.isActive && _session.value != null) {
      delay(TICK_MS)
      follow()
    }
  }

  // ---- the session's remote (Playback.remote) ----

  private val remote =
    object : RemoteQueue {
      override fun toggle() {
        val s = _session.value ?: return
        if (!s.you.host) return app.playback.notify(HOST_ONLY)
        control(buildJsonObject { put("action", if (s.playing) "pause" else "play") })
      }

      override fun next() = hostOnly { control(buildJsonObject { put("action", "next") }) }

      override fun previous() = hostOnly { control(buildJsonObject { put("action", "previous") }) }

      override fun seek(ms: Long) = hostOnly {
        control(buildJsonObject {
          put("action", "seek")
          put("positionMs", ms)
        })
      }

      override fun add(t: Track, next: Boolean) {
        app.scope.launch {
          if (share(t, next) != null) app.playback.notify(if (next) "“${t.title}” plays next for everyone" else "Added “${t.title}” to the shared queue")
        }
      }

      override fun play(list: List<Track>, index: Int) {
        val t = list.getOrNull(index) ?: return
        val s = _session.value ?: return
        app.scope.launch {
          if (!s.you.host) {
            if (share(t, false) != null) app.playback.notify("Added “${t.title}” to the shared queue")
            return@launch
          }
          val after = share(t, true) ?: return@launch
          val first = after.queue.firstOrNull()
          if (first?.track?.id == t.id && after.now?.track?.id != t.id)
            control(buildJsonObject {
              put("action", "jump")
              put("uid", first.uid)
            })
        }
      }

      override fun ended() {
        val s = _session.value ?: return
        val now = s.now ?: return
        if (s.you.host)
          control(buildJsonObject {
            put("action", "next")
            put("from", now.uid)
          })
      }
    }

  private fun hostOnly(block: () -> Unit) {
    if (_session.value?.you?.host == true) block() else app.playback.notify(HOST_ONLY)
  }

  private fun control(body: JsonObject) {
    val id = _session.value?.id ?: return
    app.scope.launch { runCatching { apply(decode(app.api.send("POST", "/together/${enc(id)}/control", body))) } }
  }

  private suspend fun share(t: Track, next: Boolean): TogetherState? {
    val id = _session.value?.id ?: return null
    if (t.provider != "navidrome") {
      app.playback.notify("Only songs from your library can be shared.")
      return null
    }
    return try {
      decode(
        app.api.send(
          "POST",
          "/together/${enc(id)}/queue",
          buildJsonObject {
            put("track", EchoJsonFull.encodeToJsonElement(t.ref()))
            put("next", next)
          },
        ),
      ).also(::apply)
    } catch (_: Exception) {
      app.playback.notify("Couldn't add that to the shared queue.")
      null
    }
  }

  // ---- joining, starting, leaving ----

  private fun attach(s: TogetherState) {
    val was = _session.value
    app.playback.remote = remote
    _session.value = s
    _offer.value = null
    if (was?.id != s.id) {
      loops.forEach { it.cancel() }
      loops = listOf(app.scope.launch { events(s.id) }, app.scope.launch { poll(s.id) }, app.scope.launch { ticker() })
    }
    follow()
  }

  private fun detach(ended: Boolean) {
    if (_session.value == null) return
    loops.forEach { it.cancel() }
    loops = emptyList()
    cue?.second?.cancel()
    cue = null
    streamOpen = false
    app.playback.remote = null
    app.playback.followPause()
    _session.value = null
    sheetOpen.value = false
    app.playback.notify(if (ended) "The listening session ended." else "You left the listening session.")
  }

  /** A link opened before signing in: offered once signed in. */
  private var pending: String? = null

  /** A session this user is already in (the app restarted), or a link opened before signing in. */
  suspend fun resume() {
    pending?.let {
      pending = null
      return offer(it)
    }
    val r = runCatching { app.api.get("/together").jsonObject["session"] }.getOrNull()
    if (r != null && r !is JsonNull) runCatching { decode(r) }.getOrNull()?.let(::attach)
  }

  /** A scanned code or an opened link: say whose session it is, then Join. */
  fun offer(id: String) {
    if (app.tokens.token.value == null) {
      pending = id
      return
    }
    _offer.value = Offer.Loading(id)
    app.scope.launch {
      try {
        val s = fetch(id)
        if (s.you.member) attach(s) else _offer.value = Offer.Ready(id, s.host.username, s.members.size)
      } catch (e: ApiError) {
        _offer.value =
          when {
            e.code == "other_library" -> Offer.OtherLibrary(id, hostOf(id))
            e.status == 404 -> Offer.Gone(id)
            else -> Offer.Failed(id)
          }
      } catch (_: Exception) {
        _offer.value = Offer.Failed(id)
      }
    }
  }

  /** The 409's `host`, which [ApiError] does not carry: asked for again, read raw. */
  private suspend fun hostOf(id: String): String =
    withContext(Dispatchers.IO) {
      runCatching {
        app.api.http.newCall(Request.Builder().url(app.api.url("/api/v1/together/${enc(id)}")).build()).execute().use {
          EchoJson.parseToJsonElement(it.body.string()).jsonObject["host"]?.jsonPrimitive?.content
        }
      }.getOrNull() ?: "The host"
    }

  fun dismissOffer() {
    _offer.value = null
  }

  fun join(id: String) {
    app.scope.launch {
      try {
        val sent = System.currentTimeMillis()
        val s = decode(app.api.send("POST", "/together/${enc(id)}/join"))
        clock.request(s.serverTime, sent, System.currentTimeMillis())
        attach(s)
        app.playback.notify("Listening together with ${s.host.username}")
      } catch (e: ApiError) {
        _offer.value = if (e.code == "other_library") Offer.OtherLibrary(id, hostOf(id)) else Offer.Failed(id)
      } catch (_: Exception) {
        _offer.value = Offer.Failed(id)
      }
    }
  }

  /** Start a session on what plays here (and what's up next), and show its code. */
  fun start(onError: (String) -> Unit) {
    if (_session.value != null) {
      sheetOpen.value = true
      return
    }
    val p = app.playback.state.value
    val t = p.track?.takeIf { it.provider == "navidrome" }
    app.scope.launch {
      try {
        val sent = System.currentTimeMillis()
        val body =
          if (t == null) buildJsonObject {}
          else
            buildJsonObject {
              put("track", EchoJsonFull.encodeToJsonElement(t.ref()))
              put("positionMs", p.positionNow())
              put("playing", p.playing)
              put("queue", EchoJsonFull.encodeToJsonElement((p.queue.nextUp + p.queue.context).filter { it.provider == "navidrome" }.take(100).map { it.ref() }))
            }
        val s = decode(app.api.send("POST", "/together", body))
        clock.request(s.serverTime, sent, System.currentTimeMillis())
        // The host's own player carries on where it was.
        settleUntil = System.currentTimeMillis() + SETTLE_MS
        attach(s)
        sheetOpen.value = true
      } catch (e: ApiError) {
        onError(if (e.code == "no_library") "Connect your Navidrome library first." else "Couldn't start listening together. Try again.")
      } catch (_: Exception) {
        onError("ECHO didn't answer. Try again.")
      }
    }
  }

  /** Leave; the host's leaving ends it for everyone. */
  fun leave() {
    val s = _session.value ?: return
    app.scope.launch {
      runCatching { app.api.send("POST", "/together/${enc(s.id)}/leave") }
      detach(ended = s.you.host)
    }
  }

  fun remove(uid: String) {
    val s = _session.value ?: return
    app.scope.launch { runCatching { apply(decode(app.api.send("DELETE", "/together/${enc(s.id)}/queue/${enc(uid)}"))) } }
  }

  fun jump(uid: String) =
    control(buildJsonObject {
      put("action", "jump")
      put("uid", uid)
    })

  /** Signed out: no session follows the next account. */
  fun clear() {
    loops.forEach { it.cancel() }
    loops = emptyList()
    app.playback.remote = null
    _session.value = null
    _offer.value = null
    sheetOpen.value = false
  }

  private companion object {
    const val HOST_ONLY = "Only the host controls playback."
  }
}
