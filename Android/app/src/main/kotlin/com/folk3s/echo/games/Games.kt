package com.folk3s.echo.games

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.folk3s.echo.EchoApp
import com.folk3s.echo.api.Album
import com.folk3s.echo.api.EchoJson
import com.folk3s.echo.api.EchoJsonFull
import com.folk3s.echo.api.LyricsAnswer
import com.folk3s.echo.api.LyricsDoc
import com.folk3s.echo.api.Track
import com.folk3s.echo.library.AlbumList
import com.folk3s.echo.stage.lyrics.lyricsQuery
import java.net.URLEncoder
import kotlin.math.max
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

// Games (v0.2, 2026-11-17): four quizzes made from the user's own library, ten questions a round,
// points for speed, and each game's record kept on the ECHO account (`/me/settings` → `games`) so
// it follows the user to every device. This file is the logic; ui/Games.kt draws it.

enum class GameKind(val id: String, val title: String, val blurb: String) {
  SongGuesser("songGuesser", "Song Guesser", "Name the song from a short clip."),
  FinishLyric("finishLyric", "Finish the Lyric", "The line cuts out. Pick the words that come next."),
  CoverReveal("coverReveal", "Cover Reveal", "Name the album as its cover comes into focus."),
  Timeline("timeline", "Timeline", "Two albums. Which came out first?"),
}

const val ROUND = 10
const val LIMIT_MS = 15_000L

/** Points for a right answer: 50, plus up to 50 for speed, less for each extra hint taken. */
fun points(elapsedMs: Long, hints: Int = 0): Int {
  val speed = (50 * (1 - elapsedMs.toDouble() / LIMIT_MS)).coerceIn(0.0, 50.0)
  return ((50 + speed) * (1 - 0.25 * hints.coerceIn(0, 2))).toInt()
}

// ---- Records ----

@Serializable
data class GameRecord(val best: Int = 0, val streak: Int = 0, val rounds: Int = 0) {
  fun merge(o: GameRecord) = GameRecord(max(best, o.best), max(streak, o.streak), max(rounds, o.rounds))
}

/**
 * Each game's record: on the account (`/me/settings`, section `games`), cached on this device so
 * the Games tab shows it at once and a round finished offline is not lost; the next sync uploads it.
 */
class GameScores(private val app: EchoApp) {
  private val sp = app.getSharedPreferences("echo.games", Context.MODE_PRIVATE)
  private val _records = MutableStateFlow(read())
  val records: StateFlow<Map<String, GameRecord>> = _records

  private fun read(): Map<String, GameRecord> =
    runCatching { EchoJson.decodeFromString<Map<String, GameRecord>>(sp.getString("records", null)!!) }.getOrDefault(emptyMap())

  private fun save(m: Map<String, GameRecord>) {
    _records.value = m
    sp.edit().putString("records", EchoJsonFull.encodeToString(m)).apply()
  }

  /** Signed out: the next account must not see these. */
  fun clear() = save(emptyMap())

  /** Takes the account's records (keeping whichever is better) and uploads any this device beat. */
  fun sync() {
    app.scope.launch {
      runCatching {
        val server = app.api.get("/me/settings").jsonObject["games"]?.jsonObject ?: return@launch
        val local = _records.value
        val merged = local.toMutableMap()
        for (k in GameKind.entries) {
          val s = server[k.id]?.let { runCatching { EchoJson.decodeFromJsonElement<GameRecord>(it) }.getOrNull() } ?: GameRecord()
          val m = (local[k.id] ?: GameRecord()).merge(s)
          merged[k.id] = m
          if (m != s) push(k, m)
        }
        save(merged)
      }
    }
  }

  /** A round's end: the record before and after it. */
  fun finish(kind: GameKind, score: Int, streak: Int): Pair<GameRecord, GameRecord> {
    val before = _records.value[kind.id] ?: GameRecord()
    val after = GameRecord(max(before.best, score), max(before.streak, streak), before.rounds + 1)
    save(_records.value + (kind.id to after))
    app.scope.launch { push(kind, after) }
    return before to after
  }

  private suspend fun push(kind: GameKind, r: GameRecord) {
    // A server older than the games section refuses this (400): the record stays here until it can.
    runCatching { app.api.send("PUT", "/me/settings", buildJsonObject { put("games", buildJsonObject { put(kind.id, EchoJsonFull.encodeToJsonElement(r)) }) }) }
  }
}

// ---- Questions ----

sealed interface Question {
  val choices: List<String>
  val answer: Int
}

/** A clip from [startMs]; the hints make it longer. */
data class GuessQ(val track: Track, override val choices: List<String>, override val answer: Int, val startMs: Long) : Question

/** The line up to the gap, the clip up to where the missing words start. */
data class LyricQ(
  val track: Track,
  val previous: String?,
  val before: String,
  override val choices: List<String>,
  override val answer: Int,
  val clipFrom: Long,
  val clipTo: Long,
) : Question

data class CoverQ(val album: Album, override val choices: List<String>, override val answer: Int) : Question

/** Which of the two came out first: [answer] is the older one's index. */
data class TimelineQ(val a: Album, val b: Album, override val answer: Int) : Question {
  override val choices = listOf(a.title, b.title)
}

class NotEnough(message: String) : Exception(message)

private fun <T> withChoices(right: String, pool: List<String>, rnd: Random, make: (List<String>, Int) -> T): T? {
  val wrong = pool.filter { it.lowercase() != right.lowercase() }.distinctBy { it.lowercase() }.shuffled(rnd).take(3)
  if (wrong.size < 3) return null
  val all = (wrong + right).shuffled(rnd)
  return make(all, all.indexOf(right))
}

/** A round's questions, from the library, for [kind]. */
suspend fun buildRound(app: EchoApp, kind: GameKind, rnd: Random = Random.Default): List<Question> =
  when (kind) {
    GameKind.SongGuesser -> songGuesser(app, rnd)
    GameKind.FinishLyric -> finishLyric(app, rnd)
    GameKind.CoverReveal -> coverReveal(app, rnd)
    GameKind.Timeline -> timeline(app, rnd)
  }

private suspend fun songGuesser(app: EchoApp, rnd: Random): List<Question> {
  val songs = app.library.randomSongs(100).distinctBy { it.title.lowercase() }
  if (songs.size < 4) throw NotEnough("Song Guesser needs at least 4 different songs in your library.")
  val titles = songs.map { it.title }
  return songs.shuffled(rnd).take(ROUND).mapNotNull { t ->
    // From somewhere a fifth to a half of the way in, past most intros.
    val start = if (t.durationMs > 40_000) (t.durationMs * (0.2 + 0.3 * rnd.nextDouble())).toLong() else 0L
    withChoices(t.title, titles, rnd) { c, i -> GuessQ(t, c, i, start) }
  }
}

private suspend fun coverReveal(app: EchoApp, rnd: Random): List<Question> {
  val albums = app.library.albumList(AlbumList.Random, 80).filter { it.cover != null }.distinctBy { it.title.lowercase() }
  if (albums.size < 4) throw NotEnough("Cover Reveal needs at least 4 albums with covers.")
  val titles = albums.map { it.title }
  return albums.shuffled(rnd).take(ROUND).mapNotNull { a -> withChoices(a.title, titles, rnd) { c, i -> CoverQ(a, c, i) } }
}

private suspend fun timeline(app: EchoApp, rnd: Random): List<Question> {
  val albums = app.library.albumList(AlbumList.Random, 120).filter { it.year != null }
  if (albums.map { it.year }.distinct().size < 2) throw NotEnough("Timeline needs albums from at least two different years.")
  val out = mutableListOf<Question>()
  val seen = HashSet<String>()
  repeat(200) {
    if (out.size >= ROUND) return out
    val a = albums.random(rnd)
    val b = albums.random(rnd)
    val key = listOf(a.id, b.id).sorted().joinToString()
    if (a.year == b.year || !seen.add(key)) return@repeat
    out += TimelineQ(a, b, if (a.year!! < b.year!!) 0 else 1)
  }
  return out
}

private val WORD = Regex("""[^\p{L}\p{N}']+""")

private fun norm(s: String) = s.lowercase().replace(WORD, " ").trim()

private data class Gap(val track: Track, val previous: String?, val before: String, val ending: String, val from: Long, val to: Long)

/** A line with its last words cut out, and where the clip stops: as the first missing word starts. */
private fun gapIn(t: Track, doc: LyricsDoc, rnd: Random): Gap? {
  if (doc.sync == "none") return null
  val lines = doc.lines.filter { it.text.isNotBlank() }
  val usable = lines.withIndex().filter { (_, l) -> l.text.trim().split(Regex("\\s+")).size in 4..14 && l.start > 0 }
  val (i, line) = usable.randomOrNull(rnd) ?: return null
  val words = line.text.trim().split(Regex("\\s+"))
  val k = if (words.size >= 7) 3 else 2
  val before = words.dropLast(k).joinToString(" ")
  val ending = words.takeLast(k).joinToString(" ")
  val end = line.end ?: lines.getOrNull(i + 1)?.start ?: (line.start + 4000)
  // Word timing when there is some; otherwise the share of the line's words before the gap.
  val cut = line.words?.let { w -> w.getOrNull(w.size - k)?.start } ?: (line.start + (end - line.start) * (words.size - k) / words.size)
  val shift = doc.offsetMs
  return Gap(t, lines.getOrNull(i - 1)?.text, before, ending, (line.start - 4000 + shift).coerceAtLeast(0), cut + shift)
}

private suspend fun finishLyric(app: EchoApp, rnd: Random): List<Question> {
  val songs = app.library.randomSongs(80).shuffled(rnd)
  val gaps = mutableListOf<Gap>()
  // A few at a time, until there are enough lines (most libraries have lyrics for some songs only).
  for (batch in songs.chunked(8)) {
    if (gaps.size >= ROUND + 4) break
    gaps +=
      coroutineScope {
        batch.map { t ->
          async {
            runCatching { EchoJson.decodeFromJsonElement<LyricsAnswer>(app.api.get(lyricsQuery(t))).doc }.getOrNull()?.let { gapIn(t, it, rnd) }
          }
        }.awaitAll().filterNotNull()
      }
  }
  val endings = gaps.map { it.ending }
  val out = gaps.distinctBy { it.track.id }.take(ROUND).mapNotNull { g ->
    val pool = endings.filter { norm(it) != norm(g.ending) }
    withChoices(g.ending, pool, rnd) { c, i -> LyricQ(g.track, g.previous, g.before, c, i, g.from, g.to) }
  }
  if (out.size < 3) throw NotEnough("Finish the Lyric needs synced lyrics for at least a few of your songs, and none were found this time.")
  return out
}

// ---- Clips ----

/**
 * The games' own player: short clips through the same authenticated client as playback. It takes
 * audio focus, so the music that was playing pauses while a clip plays.
 */
@OptIn(UnstableApi::class)
class ClipPlayer(private val app: EchoApp, private val scope: CoroutineScope) {
  private val player =
    ExoPlayer.Builder(app)
      .setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(app.api.http)))
      .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_GAME).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
      .build()
  private var loaded: String? = null
  private var stopper: Job? = null
  private val _playing = MutableStateFlow(false)
  val playing: StateFlow<Boolean> = _playing

  init {
    player.addListener(
      object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
          _playing.value = isPlaying
        }
      },
    )
  }

  /** Plays [t] from [fromMs] and pauses at [toMs]. */
  fun play(t: Track, fromMs: Long, toMs: Long) {
    stopper?.cancel()
    if (loaded != t.key) {
      val id = URLEncoder.encode(t.id, "UTF-8")
      player.setMediaItem(MediaItem.fromUri(app.api.url("/api/v1/navidrome/stream/$id?format=raw")))
      player.prepare()
      loaded = t.key
    }
    player.seekTo(fromMs)
    player.play()
    stopper =
      scope.launch {
        while (isActive) {
          if (player.currentPosition >= toMs) {
            player.pause()
            break
          }
          delay(40)
        }
      }
  }

  fun stop() {
    stopper?.cancel()
    player.pause()
  }

  fun release() {
    stopper?.cancel()
    player.release()
  }
}
