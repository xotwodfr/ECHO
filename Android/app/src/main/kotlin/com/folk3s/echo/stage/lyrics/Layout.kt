package com.folk3s.echo.stage.lyrics

import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import com.folk3s.echo.R
import com.folk3s.echo.api.LyricLine
import com.folk3s.echo.api.LyricWord
import com.folk3s.echo.api.LyricsDoc
import java.text.BreakIterator
import kotlin.math.max
import kotlin.math.min

// Line layout (layout.ts; LYRICS_EXPERIENCE.md §3.3): every line is measured once per document and
// per resize, at active size; depth is a transform, so nothing reflows when a line changes state.
// Each word (and each grapheme of a held word) is also set on its own, so the field can light,
// lift and glow it alone.

const val LINE_HEIGHT = 1.12f
const val LINE_HEIGHT_CJK = 1.2f
private const val WDTH_MIN = 82
private const val WDTH_STEP = 2
private const val SIZE_STEP = 0.02
const val BG_SIZE = 0.62f

private val families = HashMap<Int, FontFamily>()

/** Mona Sans Bold at a width (`wdth` 82–100): lines condense before they shrink. */
fun monaBold(wdth: Int): FontFamily =
  families.getOrPut(wdth) {
    FontFamily(Font(R.font.mona_sans, FontWeight.Bold, variationSettings = FontVariation.Settings(FontVariation.weight(700), FontVariation.width(wdth.toFloat()))))
  }

private fun isCjk(text: String) =
  text.codePoints().anyMatch {
    when (Character.UnicodeScript.of(it)) {
      Character.UnicodeScript.HAN, Character.UnicodeScript.HIRAGANA, Character.UnicodeScript.KATAKANA, Character.UnicodeScript.HANGUL -> true
      else -> false
    }
  }

/** Cursive scripts join their letters, so they are never set one box per grapheme. */
private fun isJoined(text: String) =
  text.codePoints().anyMatch {
    when (Character.UnicodeScript.of(it)) {
      Character.UnicodeScript.ARABIC, Character.UnicodeScript.SYRIAC, Character.UnicodeScript.NKO, Character.UnicodeScript.MONGOLIAN, Character.UnicodeScript.ADLAM -> true
      else -> false
    }
  }

fun graphemes(text: String): List<String> {
  val it = BreakIterator.getCharacterInstance().apply { setText(text) }
  val out = mutableListOf<String>()
  var start = it.first()
  var end = it.next()
  while (end != BreakIterator.DONE) {
    out += text.substring(start, end)
    start = end
    end = it.next()
  }
  return out
}

/** Held-word emphasis (§5.5): ≥ 1000 ms and 2–7 graphemes (CJK: duration only), never joined scripts. */
fun emphasisOf(w: LyricWord, last: Boolean): Emphasis? {
  val dur = (w.end - w.start).toDouble()
  if (dur < 150 || dur < L.Emphasis.minMs || isJoined(w.text)) return null
  val n = graphemes(w.text).size
  if (!isCjk(w.text) && (n < L.Emphasis.minG || n > L.Emphasis.maxG)) return null
  val a = min(1.2, (dur - L.Emphasis.minMs) / 1500 + 0.6) * (if (last) 1.4 else 1.0)
  return Emphasis(min(L.Emphasis.swellMax, 0.05 * a), 0.05, min(0.04, 0.03 * a), dur / 2.5 / n)
}

/** Line-timed sources mark backing vocals with parentheses (§5.6): `lead (backing)`. */
fun splitBacking(text: String): Pair<String, List<String>> {
  val backing = mutableListOf<String>()
  val lead = Regex("\\s*\\(([^()]+)\\)").replace(text) { m -> backing += m.groupValues[1].trim(); "" }.trim()
  return if (lead.isNotEmpty()) lead to backing else text to emptyList()
}

/** Duet sides, once per document (§4.4). Group agents stay centred. */
fun sidesOf(doc: LyricsDoc): (LyricLine) -> Side {
  val agents = doc.lines.mapNotNull { it.agent }.distinct()
  val flagged = doc.lines.any { it.oppositeAligned }
  if (!flagged && agents.size < 2) return { Side.Centre }
  val group = doc.agents.orEmpty().filter { it.kind == "group" }.map { it.id }.toSet()
  return { l ->
    when {
      l.agent != null && l.agent in group -> Side.Centre
      flagged -> if (l.oppositeAligned) Side.Right else Side.Left
      else -> if (l.agent != null && l.agent != agents.first()) Side.Right else Side.Left
    }
  }
}

/** One word as drawn: its own layout at its place in the line (px, the line box at scale 1). */
class WordDraw(val text: TextLayoutResult, val x: Float, val y: Float, val graphemes: List<WordDraw> = emptyList()) {
  val w: Float get() = text.size.width.toFloat()
  val h: Float get() = text.size.height.toFloat()
}

class LineLayout(
  val box: LineBox,
  val rtl: Boolean,
  val em: Float, // px
  val words: List<WordDraw>, // lead words (word-timed), or the whole lead (line-timed wash)
  val backing: List<List<WordDraw>>, // backing sub-lines, word by word (a line-timed line: one each)
  val wash: Boolean,
)

class DocLayout(val fontPx: Float, val lines: List<LineLayout>)

private fun style(fontPx: Float, wdth: Int, size: Float, cjk: Boolean, scale: Float = 1f, end: Boolean = false) =
  TextStyle(
    textAlign = if (end) androidx.compose.ui.text.style.TextAlign.End else androidx.compose.ui.text.style.TextAlign.Start,
    fontFamily = monaBold(wdth),
    fontWeight = FontWeight.Bold,
    fontSize = TextUnit(fontPx * size * scale, androidx.compose.ui.unit.TextUnitType.Sp),
    letterSpacing = if (cjk) 0.em else (-0.022).em,
    lineHeight = (if (cjk) LINE_HEIGHT_CJK else LINE_HEIGHT).em,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
    lineBreak = LineBreak.Paragraph,
  )

private fun leadText(line: LyricLine): Pair<String, List<IntRange>> {
  val words = line.words ?: return splitBacking(line.text).first to emptyList()
  val sb = StringBuilder()
  val ranges = words.mapIndexed { k, w ->
    val start = sb.length
    sb.append(w.text)
    val r = start until sb.length
    if (!w.isPartOfWord && k < words.lastIndex) sb.append(' ')
    r
  }
  return sb.toString() to ranges
}

/**
 * Measures every displayed line at the stage width. `fontPx` is the active size in px (the
 * TextMeasurer's sp are set to px by a 1:1 density, so sizes here are px throughout).
 */
fun measureDoc(m: TextMeasurer, doc: LyricsDoc, lines: List<LyricLine>, width: Float, fontPx: Float): DocLayout {
  val maxW = (L.maxWidth * width).toInt().coerceAtLeast(1)
  val side = sidesOf(doc)
  val c = Constraints(maxWidth = maxW)
  return DocLayout(
    fontPx,
    lines.map { line ->
      val cjk = isCjk(line.text)
      val lineSide = side(line)
      val end = lineSide == Side.Right
      val (text, ranges) = leadText(line)
      // Two rows at most: condense to wdth 82, then shrink by up to 12% (§3.3).
      var wdth = 100
      var size = 1.0
      fun rows() = m.measure(text, style(fontPx, wdth, size.toFloat(), cjk, end = end), constraints = c).lineCount
      var r = rows()
      while (r > L.maxRows && wdth > WDTH_MIN) {
        wdth = max(WDTH_MIN, wdth - WDTH_STEP)
        r = rows()
      }
      while (r > L.maxRows && size > 1 - L.shrinkMax + 1e-9) {
        size = max(1 - L.shrinkMax, size - SIZE_STEP)
        r = rows()
      }
      val st = style(fontPx, wdth, size.toFloat(), cjk, end = end)
      val lead = m.measure(text, st, constraints = c)
      val em = fontPx * size.toFloat()
      val leadW = (0 until lead.lineCount).maxOf { lead.getLineRight(it) - lead.getLineLeft(it) }
      // Rows sit at the constraint's start, or its end for the second voice: into the line's own box.
      val shift = if (end) maxW - leadW else 0f
      val rtl = lead.layoutInput.text.isNotEmpty() && lead.getParagraphDirection(0) == androidx.compose.ui.text.style.ResolvedTextDirection.Rtl
      val words =
        if (line.words == null) listOf(WordDraw(lead, -shift, 0f))
        else
          line.words.mapIndexed { k, w ->
            val box = lead.getBoundingBox(ranges[k].first)
            val own = m.measure(w.text, style(fontPx, wdth, size.toFloat(), cjk))
            val gs =
              if (emphasisOf(w, k == line.words.lastIndex) == null) emptyList()
              else {
                var gx = 0f
                graphemes(w.text).map { g ->
                  val gl = m.measure(g, style(fontPx, wdth, size.toFloat(), cjk))
                  WordDraw(gl, gx, 0f).also { gx += gl.size.width }
                }
              }
            val x = (if (rtl) box.right - own.size.width else box.left) - shift
            WordDraw(own, x, lead.getLineTop(lead.getLineForOffset(ranges[k].first)), gs)
          }
      // Backing vocals under the lead line, at 0.62 of its size (§5.6).
      var y = lead.size.height.toFloat()
      val bst = style(fontPx, wdth, size.toFloat(), cjk, BG_SIZE)
      val backing =
        if (line.words != null) {
          line.background.orEmpty().map { b ->
            val ws = b.words ?: listOf(LyricWord(b.text, b.start ?: line.start, b.end ?: line.start, false))
            var x = 0f
            val row = ws.map { w ->
              val l = m.measure(w.text + if (w.isPartOfWord) "" else " ", bst)
              WordDraw(l, x, y).also { x += l.size.width }
            }
            y += row.maxOfOrNull { it.h } ?: 0f
            row
          }
        } else {
          splitBacking(line.text).second.map { t ->
            val l = m.measure(t, bst, constraints = c)
            listOf(WordDraw(l, 0f, y)).also { y += l.size.height }
          }
        }
      val backW = backing.flatten().maxOfOrNull { it.x + it.w } ?: 0f
      val box =
        LineBox(
          max(leadW, backW),
          y,
          lineSide,
          if (line.words == null) emptyList()
          else words.mapIndexed { k, d -> WordBox(Rect(d.x, d.y, d.w, d.h), emphasisOf(line.words[k], k == line.words.lastIndex), d.graphemes.map { g -> Rect(d.x + g.x, d.y, g.w, g.h) }) },
        )
      LineLayout(box, rtl, em, words, backing, line.words == null)
    },
  )
}
