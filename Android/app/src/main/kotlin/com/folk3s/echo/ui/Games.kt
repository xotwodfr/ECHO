package com.folk3s.echo.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.folk3s.echo.games.ClipPlayer
import com.folk3s.echo.games.CoverQ
import com.folk3s.echo.games.GameKind
import com.folk3s.echo.games.GameRecord
import com.folk3s.echo.games.GuessQ
import com.folk3s.echo.games.LIMIT_MS
import com.folk3s.echo.games.LyricQ
import com.folk3s.echo.games.NotEnough
import com.folk3s.echo.games.Question
import com.folk3s.echo.games.TimelineQ
import com.folk3s.echo.games.buildRound
import com.folk3s.echo.games.points
import com.folk3s.echo.echo
import kotlin.math.max
import kotlinx.coroutines.delay

// The Games tab and a round (games/Games.kt holds the logic): a card per game with its record, ten
// questions with a countdown, the answers as big rounded buttons, and the round's result.

private fun GameKind.colours(): List<Color> =
  when (this) {
    GameKind.SongGuesser -> listOf(Color(0xFFE5375B), Color(0xFF7B2FBE))
    GameKind.FinishLyric -> listOf(Color(0xFFF08A24), Color(0xFFD9365E))
    GameKind.CoverReveal -> listOf(Color(0xFF14A38B), Color(0xFF2266C7))
    GameKind.Timeline -> listOf(Color(0xFF3D5AFE), Color(0xFF1B1F6B))
  }

private fun GameKind.icon(): ImageVector =
  when (this) {
    GameKind.SongGuesser -> EchoIcons.music
    GameKind.FinishLyric -> EchoIcons.lyrics
    GameKind.CoverReveal -> EchoIcons.disc
    GameKind.Timeline -> EchoIcons.clock
  }

// ---- The tab ----

@Composable
fun GamesScreen(nav: Nav) {
  val app = LocalContext.current.echo
  val records by app.games.records.collectAsStateWithLifecycle()
  LaunchedEffect(Unit) { app.games.sync() }
  LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomRoom) {
    item { LargeTitle("Games") { Avatar { nav.go(Route.Settings) } } }
    item {
      Text(
        "Quizzes made from your own library. Your best scores are saved to your ECHO account.",
        color = Chamber.muted,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 8.dp),
      )
    }
    items(GameKind.entries, key = { it.id }) { k -> GameCard(k, records[k.id]) { nav.go(Route.Game(k)) } }
  }
}

@Composable
private fun GameCard(kind: GameKind, record: GameRecord?, onClick: () -> Unit) {
  Box(
    Modifier.padding(horizontal = 20.dp, vertical = 7.dp).fillMaxWidth().height(150.dp).clip(RoundedCornerShape(28.dp))
      .background(Brush.linearGradient(kind.colours())).clickable(onClick = onClick).semantics { contentDescription = "Play ${kind.title}" },
  ) {
    Icon(kind.icon(), null, tint = Color.White.copy(alpha = 0.18f), modifier = Modifier.align(Alignment.CenterEnd).padding(end = 12.dp).size(120.dp))
    Column(Modifier.align(Alignment.BottomStart).padding(20.dp).padding(end = 80.dp)) {
      Text(kind.title, color = Color.White, style = MaterialTheme.typography.headlineSmall)
      Text(kind.blurb, color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium, maxLines = 2)
      Spacer(Modifier.height(8.dp))
      Text(
        if (record == null || record.rounds == 0) "Not played yet" else "Best ${record.best} · Streak ${record.streak} · ${record.rounds} round${if (record.rounds == 1) "" else "s"}",
        color = Color.White,
        style = MaterialTheme.typography.labelLarge,
      )
    }
    Box(
      Modifier.align(Alignment.TopEnd).padding(16.dp).size(44.dp).clip(RoundedCornerShape(16.dp)).background(Color.White),
      contentAlignment = Alignment.Center,
    ) { Icon(EchoIcons.play, null, tint = kind.colours().last(), modifier = Modifier.size(20.dp)) }
  }
}

// ---- A round ----

@Composable
fun GameScreen(kind: GameKind, nav: Nav) {
  val app = LocalContext.current.echo
  val scope = rememberCoroutineScope()
  val clips = remember { ClipPlayer(app, scope) }
  var attempt by remember { mutableIntStateOf(0) }
  var questions by remember { mutableStateOf<List<Question>?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  DisposableEffect(Unit) {
    // The music pauses for the game (the clips take audio focus too).
    if (app.playback.state.value.playing) app.playback.toggle()
    onDispose { clips.release() }
  }
  LaunchedEffect(attempt) {
    questions = null
    error = null
    runCatching { buildRound(app, kind) }
      .onSuccess { if (it.isEmpty()) error = "There isn't enough music in your library for this game yet." else questions = it }
      .onFailure { error = (it as? NotEnough)?.message ?: "Couldn't load your library. Check your connection and try again." }
  }
  val qs = questions
  Column(Modifier.fillMaxSize()) {
    when {
      error != null ->
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
          Icon(kind.icon(), null, tint = Chamber.muted, modifier = Modifier.size(56.dp))
          Spacer(Modifier.height(16.dp))
          Text(error!!, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge)
          Spacer(Modifier.height(20.dp))
          Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FilledTonalButton(onClick = { nav.back() }) { Text("Back") }
            Button(onClick = { attempt++ }) { Text("Try again") }
          }
        }
      qs == null ->
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
          Loading()
          Text(if (kind == GameKind.FinishLyric) "Finding lyrics in your library…" else "Picking from your library…", color = Chamber.muted)
        }
      else -> androidx.compose.runtime.key(attempt) { Round(kind, qs, clips, onAgain = { attempt++ }, onExit = { nav.back() }) }
    }
  }
}

private enum class Mark { Right, Wrong, Missed }

@Composable
private fun Round(kind: GameKind, qs: List<Question>, clips: ClipPlayer, onAgain: () -> Unit, onExit: () -> Unit) {
  val app = LocalContext.current.echo
  var index by remember { mutableIntStateOf(0) }
  var score by remember { mutableIntStateOf(0) }
  var streak by remember { mutableIntStateOf(0) }
  var bestStreak by remember { mutableIntStateOf(0) }
  val marks = remember { mutableStateListOf<Mark>() }
  var chosen by remember { mutableStateOf<Int?>(null) }
  var hints by remember { mutableIntStateOf(0) }
  fun hasAudio(x: Question) = x is GuessQ || x is LyricQ
  // When the clock started: at once for a picture, when the sound starts for a clip.
  var started by remember { mutableStateOf(if (hasAudio(qs[0])) null else System.currentTimeMillis()) }
  var elapsed by remember { mutableLongStateOf(0L) }
  var gained by remember { mutableIntStateOf(0) }
  var result by remember { mutableStateOf<Pair<GameRecord, GameRecord>?>(null) }
  val playing by clips.playing.collectAsStateWithLifecycle()

  result?.let { (before, after) ->
    Results(kind, score, marks.count { it == Mark.Right }, qs.size, bestStreak, before, after, onAgain, onExit)
    return
  }
  val q = qs[index]
  val audio = hasAudio(q)

  fun answer(i: Int) {
    if (chosen != null) return
    chosen = i
    if (i == q.answer) {
      gained = points(elapsed, hints)
      score += gained
      streak++
      bestStreak = max(bestStreak, streak)
      marks += Mark.Right
    } else {
      gained = 0
      streak = 0
      marks += if (i < 0) Mark.Missed else Mark.Wrong
    }
  }

  // Each question: its clip plays, and the clock starts once the sound does (or at once).
  LaunchedEffect(index) {
    when (q) {
      is GuessQ -> clips.play(q.track, q.startMs, q.startMs + CLIPS[0])
      is LyricQ -> clips.play(q.track, q.clipFrom, q.clipTo)
      else -> clips.stop()
    }
  }
  LaunchedEffect(index, playing) { if (playing && started == null) started = System.currentTimeMillis() }
  LaunchedEffect(index, chosen, started) {
    val s = started ?: return@LaunchedEffect
    while (chosen == null) {
      elapsed = System.currentTimeMillis() - s
      if (elapsed >= LIMIT_MS) answer(-1)
      delay(50)
    }
  }
  // After an answer: the rest of the line or more of the song, then the next question.
  LaunchedEffect(index, chosen) {
    if (chosen == null) return@LaunchedEffect
    when (q) {
      is LyricQ -> clips.play(q.track, q.clipTo, q.clipTo + 3500)
      is GuessQ -> if (!playing) clips.play(q.track, q.startMs, q.startMs + 4000)
      else -> {}
    }
    delay(if (audio) 2600 else 1800)
    if (index + 1 < qs.size) {
      // The next question's state, all at once, so nothing sees it half reset.
      hints = 0
      elapsed = 0
      started = if (hasAudio(qs[index + 1])) null else System.currentTimeMillis()
      chosen = null
      index++
    } else {
      clips.stop()
      result = app.games.finish(kind, score, bestStreak)
    }
  }

  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
    // Close, where we are, the score.
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
      Box(
        Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable(onClick = onExit)
          .semantics { contentDescription = "Leave the game" },
        contentAlignment = Alignment.Center,
      ) { Icon(EchoIcons.close, null, modifier = Modifier.size(20.dp)) }
      Text("${kind.title} · ${index + 1} of ${qs.size}", style = MaterialTheme.typography.titleSmall, color = Chamber.muted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
      Text("$score", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(end = 8.dp).semantics { contentDescription = "Score $score" })
    }
    // A segment per question: right, wrong, this one, to come.
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      for (i in qs.indices) {
        val c =
          when (marks.getOrNull(i)) {
            Mark.Right -> RIGHT
            Mark.Wrong, Mark.Missed -> MaterialTheme.colorScheme.error
            null -> if (i == index) MaterialTheme.colorScheme.primary.copy(alpha = 0.5f) else Chamber.line
          }
        Box(Modifier.weight(1f).height(5.dp).clip(CircleShape).background(c))
      }
    }
    LinearProgressIndicator(
      progress = { if (started == null) 1f else (1f - elapsed.toFloat() / LIMIT_MS).coerceIn(0f, 1f) },
      modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp).height(6.dp).clip(CircleShape),
      color = if (elapsed > LIMIT_MS * 0.7) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
      trackColor = MaterialTheme.colorScheme.surfaceContainerHigh,
      drawStopIndicator = {},
    )
    // The question itself.
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      when (q) {
        is GuessQ -> {
          Listening(kind, playing, chosen != null, q.track.cover, if (chosen != null) "${q.track.title} · ${q.track.artist}" else "What's this song?", canMore = hints < 2) {
            if (chosen == null && hints < 2) {
              hints++
              clips.play(q.track, q.startMs, q.startMs + CLIPS[hints])
            }
          }
          if (chosen == null) HintNote(hints)
        }
        is LyricQ -> LyricPrompt(q, playing, chosen, onReplay = { clips.play(q.track, q.clipFrom, q.clipTo) })
        is CoverQ -> CoverPrompt(q, elapsed, chosen != null)
        is TimelineQ -> {}
      }
    }
    if (q is TimelineQ) TimelinePrompt(q, chosen) { answer(it) }
    else
      Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        q.choices.forEachIndexed { i, c -> ChoiceButton(c, stateOf(i, q.answer, chosen)) { answer(i) } }
      }
    if (chosen != null)
      Text(
        when {
          chosen == q.answer -> "Right! +$gained"
          chosen == -1 -> "Out of time"
          else -> "Not quite"
        },
        style = MaterialTheme.typography.titleLarge,
        color = if (chosen == q.answer) RIGHT else MaterialTheme.colorScheme.error,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
      )
  }
}

/** Song Guesser's clip lengths: the first listen, then the two longer hints. */
private val CLIPS = listOf(2_000L, 5_000L, 10_000L)

private val RIGHT = Color(0xFF1E9E55)

private enum class ChoiceState { Open, Right, Wrong, Dim }

private fun stateOf(i: Int, answer: Int, chosen: Int?): ChoiceState =
  when {
    chosen == null -> ChoiceState.Open
    i == answer -> ChoiceState.Right
    i == chosen -> ChoiceState.Wrong
    else -> ChoiceState.Dim
  }

@Composable
private fun ChoiceButton(text: String, state: ChoiceState, onClick: () -> Unit) {
  val bg by animateColorAsState(
    when (state) {
      ChoiceState.Right -> RIGHT
      ChoiceState.Wrong -> MaterialTheme.colorScheme.error
      else -> MaterialTheme.colorScheme.surfaceContainerHigh
    },
    tween(200),
    label = "choice",
  )
  val fg = if (state == ChoiceState.Right || state == ChoiceState.Wrong) Color.White else Chamber.text
  Box(
    Modifier.fillMaxWidth().heightIn(min = 60.dp).alpha(if (state == ChoiceState.Dim) 0.45f else 1f).clip(RoundedCornerShape(20.dp)).background(bg)
      .clickable(enabled = state == ChoiceState.Open, onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp),
    contentAlignment = Alignment.CenterStart,
  ) { Text(text, color = fg, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis) }
}

/** The listening card: the cover hidden until the answer, a pulse while the clip plays. */
@Composable
private fun Listening(kind: GameKind, playing: Boolean, revealed: Boolean, cover: String?, caption: String, canMore: Boolean, onMore: () -> Unit) {
  Box(
    Modifier.size(220.dp).clip(RoundedCornerShape(28.dp)).background(Brush.linearGradient(kind.colours())),
    contentAlignment = Alignment.Center,
  ) {
    if (revealed && cover != null) Artwork(cover.replace("size=300", "size=600"), caption, null, Modifier.fillMaxSize(), radius = 28.dp)
    else Icon(if (playing) EchoIcons.volume else EchoIcons.music, null, tint = Color.White, modifier = Modifier.size(72.dp))
  }
  Spacer(Modifier.height(14.dp))
  Text(caption, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
  if (!revealed)
    FilledTonalButton(onClick = onMore, enabled = canMore, modifier = Modifier.padding(top = 10.dp)) {
      Icon(EchoIcons.plus, null, modifier = Modifier.size(18.dp))
      Spacer(Modifier.width(6.dp))
      Text("Longer clip")
    }
}

@Composable
private fun HintNote(hints: Int) {
  Text(
    when (hints) {
      0 -> "2 seconds. A longer clip costs a quarter of the points."
      1 -> "5 seconds. One more: 10 seconds."
      else -> "10 seconds, the longest clip."
    },
    color = Chamber.muted,
    style = MaterialTheme.typography.bodySmall,
    textAlign = TextAlign.Center,
    modifier = Modifier.padding(top = 6.dp),
  )
}

@Composable
private fun LyricPrompt(q: LyricQ, playing: Boolean, chosen: Int?, onReplay: () -> Unit) {
  Column(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Brush.linearGradient(GameKind.FinishLyric.colours())).padding(22.dp),
  ) {
    Text("${q.track.title} · ${q.track.artist}", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    Spacer(Modifier.height(12.dp))
    q.previous?.let { Text(it, color = Color.White.copy(alpha = 0.5f), style = MaterialTheme.typography.titleLarge) }
    val ending = if (chosen != null) q.choices[q.answer] else "_____"
    Text("${q.before} $ending", color = Color.White, style = MaterialTheme.typography.headlineSmall)
  }
  if (chosen == null)
    FilledTonalButton(onClick = onReplay, enabled = !playing, modifier = Modifier.padding(top = 10.dp)) {
      Icon(EchoIcons.play, null, modifier = Modifier.size(18.dp))
      Spacer(Modifier.width(6.dp))
      Text(if (playing) "Listening…" else "Hear it again")
    }
}

/** The cover from 16 px blocks to sharp, a step every 2.5 s; whole once answered. */
@Composable
private fun CoverPrompt(q: CoverQ, elapsed: Long, revealed: Boolean) {
  val api = LocalContext.current.echo.api
  val steps = listOf(16, 24, 32, 48, 96)
  val size = if (revealed) 600 else steps[(elapsed / 2500).toInt().coerceIn(0, steps.lastIndex)]
  val path = q.album.cover!!.replace(Regex("size=\\d+"), "size=$size")
  Box(Modifier.size(260.dp).clip(RoundedCornerShape(24.dp)).background(Chamber.surface3)) {
    AsyncImage(api.url(path), "The album cover, blurred", Modifier.fillMaxSize(), contentScale = ContentScale.Crop, filterQuality = if (revealed) FilterQuality.Medium else FilterQuality.None)
  }
  Spacer(Modifier.height(12.dp))
  Text(if (revealed) "${q.album.title} · ${q.album.artist}" else "Which album is this?", style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
}

@Composable
private fun TimelinePrompt(q: TimelineQ, chosen: Int?, onPick: (Int) -> Unit) {
  Text("Which came out first?", style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
  Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
    for ((i, a) in listOf(q.a, q.b).withIndex()) {
      val state = stateOf(i, q.answer, chosen)
      val ring by animateColorAsState(
        when (state) {
          ChoiceState.Right -> RIGHT
          ChoiceState.Wrong -> MaterialTheme.colorScheme.error
          else -> MaterialTheme.colorScheme.surfaceContainerHigh
        },
        tween(200),
        label = "ring",
      )
      Column(
        Modifier.weight(1f).clip(RoundedCornerShape(24.dp)).background(ring).clickable(enabled = chosen == null) { onPick(i) }.padding(8.dp)
          .semantics { contentDescription = "${a.title} by ${a.artist}" },
      ) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f)) { Artwork(a.cover, a.title, null, Modifier.fillMaxSize(), radius = 18.dp) }
        val fg = if (state == ChoiceState.Right || state == ChoiceState.Wrong) Color.White else Chamber.text
        Text(a.title, color = fg, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 6.dp, end = 6.dp, top = 8.dp))
        Text(a.artist, color = fg.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 6.dp))
        Text(
          if (chosen != null) "${a.year}" else "????",
          color = fg,
          style = MaterialTheme.typography.headlineSmall.copy(fontStyle = if (chosen == null) FontStyle.Italic else FontStyle.Normal),
          modifier = Modifier.padding(6.dp),
        )
      }
    }
  }
}

@Composable
private fun Results(kind: GameKind, score: Int, right: Int, total: Int, bestStreak: Int, before: GameRecord, after: GameRecord, onAgain: () -> Unit, onExit: () -> Unit) {
  val newBest = score > before.best && score > 0
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Column(
      Modifier.fillMaxWidth().clip(RoundedCornerShape(32.dp)).background(Brush.linearGradient(kind.colours())).padding(28.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Text(kind.title.uppercase(), color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.labelLarge)
      Text("$score", color = Color.White, style = MaterialTheme.typography.displayLarge)
      Text("points", color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.titleMedium)
      if (newBest)
        Text(
          "New best!",
          color = kind.colours().last(),
          style = MaterialTheme.typography.labelLarge,
          modifier = Modifier.padding(top = 12.dp).clip(CircleShape).background(Color.White).padding(horizontal = 14.dp, vertical = 6.dp),
        )
    }
    Spacer(Modifier.height(16.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      Stat("$right/$total", "Right", Modifier.weight(1f))
      Stat("$bestStreak", "Streak", Modifier.weight(1f))
      Stat("${after.best}", "Your best", Modifier.weight(1f))
    }
    Text(
      "Best streak ever: ${after.streak} · Rounds played: ${after.rounds}",
      color = Chamber.muted,
      style = MaterialTheme.typography.bodyMedium,
      modifier = Modifier.padding(top = 14.dp),
    )
    Spacer(Modifier.height(20.dp))
    Button(onClick = onAgain, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(26.dp)) { Text("Play again", style = MaterialTheme.typography.titleMedium) }
    Spacer(Modifier.height(10.dp))
    FilledTonalButton(onClick = onExit, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(26.dp)) { Text("Back to Games", style = MaterialTheme.typography.titleMedium) }
  }
}

@Composable
private fun Stat(big: String, label: String, modifier: Modifier) {
  Column(modifier.clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Text(big, style = MaterialTheme.typography.headlineSmall)
    Text(label, color = Chamber.muted, style = MaterialTheme.typography.labelMedium)
  }
}
