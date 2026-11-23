import CoreGraphics
import CoreText
import Foundation

// Line layout (LYRICS_EXPERIENCE.md §3.3; src/client/stage/lyrics/layout.ts): every line is set
// once per document and per size, at the active size, with CoreText's measurements of the face the
// field draws with. Distance is opacity and blur, so nothing reflows when a line changes state, and
// the frame loop never measures. Each word (and each letter of a held word) gets its own box, so
// the field can light, lift and glow it alone.

/// A piece of text as drawn: its frame in its line's box at scale 1 (the top at the baseline less
/// the face's ascent), and, for a held word, each letter's.
struct LyricPiece: Equatable, Sendable {
    var text: String
    var rect: CGRect
    var graphemes: [LyricPiece] = []
}

/// What the field model knows about a word's box (`LineBox.words` on the web).
struct LyricWordBox: Equatable, Sendable {
    var rect: CGRect
    var emphasis: LyricEmphasis?
    var graphemes: [CGRect]
}

/// What the field model knows about a line's layout.
struct LyricLineBox: Equatable, Sendable {
    var w: Double
    var h: Double
    var side: LyricSide
    var words: [LyricWordBox] = []
}

struct LyricLineLayout: Equatable, Sendable {
    var box: LyricLineBox
    var rtl: Bool
    var cjk: Bool
    /// The lead's size (points), after fitting.
    var size: Double
    /// Word-synced: one per word. Line-synced: the line's words, lit by one wash along them.
    var lead: [LyricPiece]
    var timed: Bool
    /// Per backing sub-line, word by word, at 0.62 of the size.
    var backing: [[LyricPiece]]
    /// Whether the backing sub-lines' words are timed (word-synced lines with `words`).
    var backingTimed: [Bool]
}

struct LyricDocLayout: Equatable, Sendable {
    /// The active size, points.
    var size: Double
    /// One row at the active size: the dots' box.
    var rowH: Double
    /// The stage width it was set for.
    var width: Double
    var lines: [LyricLineLayout]
}

enum LyricTypesetter {
    static let backingSize = 0.62

    /// Sets every shown line (`timeline.lines`) for a lyric area `width` points wide.
    static func layout(_ doc: LyricsDoc, lines: [LyricLine], width: Double, style: LyricStyle) -> LyricDocLayout {
        let ruler = Ruler(style: style)
        let maxW = LyricsConfig.maxWidth * width
        let side = LyricText.sides(doc)
        let set = lines.map { line(for: $0, side: side($0), maxW: maxW, style: style, ruler: ruler) }
        return LyricDocLayout(size: style.face.size, rowH: style.face.size * style.face.lineHeight, width: width, lines: set)
    }

    // MARK: - A line

    /// A unit the line breaks between: a word (its syllables never part) with what follows it.
    private struct Unit {
        /// Each piece's text, its offset in the unit and its width (points at the active size).
        var parts: [(text: String, x: Double, w: Double)]
        var w: Double
        var space: Bool
    }

    private static func line(
        for line: LyricLine, side: LyricSide, maxW: Double, style: LyricStyle, ruler: Ruler
    ) -> LyricLineLayout {
        let size = style.face.size
        let cjk = LyricText.isCJK(line.text)
        let rtl = LyricText.direction(line.text) == .rtl
        let words = line.words ?? []
        let timed = !words.isEmpty
        var backingTexts: [(words: [LyricWord]?, text: String)] = []
        let units: [Unit]
        if timed {
            units = Self.units(words, cjk: cjk, rtl: rtl, size: size, ruler: ruler)
            for b in line.background ?? [] { backingTexts.append((b.words, b.text)) }
        } else {
            let split = LyricText.splitBacking(line.text)
            units = Self.units(text: split.lead, cjk: cjk, size: size, ruler: ruler)
            for b in split.backing { backingTexts.append((nil, b)) }
        }
        let spaceW = ruler.width(" ", size)
        let fit = LyricText.fit { k in Self.rows(units, scale: k, maxW: maxW, spaceW: spaceW).count }
        let k = fit.size
        let em = size * k
        let lh = cjk ? style.face.lineHeightCJK : style.face.lineHeight
        let metrics = ruler.metrics(em)
        let leadRows = Self.rows(units, scale: k, maxW: maxW, spaceW: spaceW)

        // The lead, row by row; each row's own width, to align it once the box is known.
        var placed: [(row: Int, part: (text: String, x: Double, w: Double), wordIndex: Int)] = []
        var rowWidths: [Double] = []
        var unitStart: [Int] = []
        var count = 0
        for u in units {
            unitStart.append(count)
            count += u.parts.count
        }
        let rowH = em * lh
        for (r, row) in leadRows.enumerated() {
            let rowW = Self.width(of: row, units, scale: k, spaceW: spaceW)
            rowWidths.append(rowW)
            var cursor = 0.0
            for (n, u) in row.enumerated() {
                let unit = units[u]
                let uw = unit.w * k
                let ux = rtl ? rowW - cursor - uw : cursor
                for (j, part) in unit.parts.enumerated() {
                    placed.append(
                        (row: r, part: (text: part.text, x: ux + part.x * k, w: part.w * k), wordIndex: unitStart[u] + j))
                }
                cursor += uw + (n < row.count - 1 && unit.space ? spaceW * k : 0)
            }
        }
        let leadH = Double(leadRows.count) * rowH

        // Backing vocals under the lead, at 0.62 of its size (§5.6), wrapped the same way.
        let bk = k * backingSize
        let bem = size * bk
        let bRowH = bem * lh
        let bMetrics = ruler.metrics(bem)
        var backingPlaced: [[(row: Double, x: Double, w: Double, text: String, rowW: Double)]] = []
        var y = leadH
        var widest = rowWidths.max() ?? 0
        for b in backingTexts {
            let bu: [Unit]
            if let ws = b.words, !ws.isEmpty {
                bu = Self.units(ws, cjk: cjk, rtl: rtl, size: size, ruler: ruler)
            } else {
                bu = Self.units(text: b.text, cjk: cjk, size: size, ruler: ruler)
            }
            let brows = Self.rows(bu, scale: bk, maxW: maxW, spaceW: spaceW)
            var sub: [(row: Double, x: Double, w: Double, text: String, rowW: Double)] = []
            for row in brows {
                let rowW = Self.width(of: row, bu, scale: bk, spaceW: spaceW)
                widest = max(widest, rowW)
                var cursor = 0.0
                for (n, u) in row.enumerated() {
                    let unit = bu[u]
                    let uw = unit.w * bk
                    let ux = rtl ? rowW - cursor - uw : cursor
                    for part in unit.parts {
                        sub.append((row: y, x: ux + part.x * bk, w: part.w * bk, text: part.text, rowW: rowW))
                    }
                    cursor += uw + (n < row.count - 1 && unit.space ? spaceW * bk : 0)
                }
                y += bRowH
            }
            backingPlaced.append(sub)
        }
        let boxW = widest
        // A right-to-left line outside a duet ends at the column's right edge too (§4.3, §5.4).
        let boxSide: LyricSide = side == .centre && rtl ? .right : side
        let alignEnd = boxSide == .right || rtl

        func top(_ rowTop: Double, _ rowHeight: Double, _ m: (ascent: Double, descent: Double)) -> Double {
            // CSS's half-leading: the face's ascent and descent centred in the row.
            rowTop + (rowHeight - (m.ascent + m.descent)) / 2
        }

        var lead: [LyricPiece] = []
        var wordBoxes: [LyricWordBox] = []
        for p in placed {
            let shift = alignEnd ? boxW - rowWidths[p.row] : 0
            let rect = CGRect(
                x: p.part.x + shift, y: top(Double(p.row) * rowH, rowH, metrics), width: p.part.w,
                height: metrics.ascent + metrics.descent)
            var piece = LyricPiece(text: p.part.text, rect: rect)
            var emphasis: LyricEmphasis? = nil
            if timed {
                emphasis = LyricText.emphasis(words[p.wordIndex], last: p.wordIndex == words.count - 1)
                if emphasis != nil {
                    var gx = 0.0
                    piece.graphemes = LyricText.graphemes(p.part.text).map { g -> LyricPiece in
                        let gw = ruler.width(g, em)
                        let x = rtl ? Double(rect.maxX) - gx - gw : Double(rect.minX) + gx
                        gx += gw
                        return LyricPiece(text: g, rect: CGRect(x: x, y: rect.minY, width: gw, height: rect.height))
                    }
                }
                wordBoxes.append(LyricWordBox(rect: rect, emphasis: emphasis, graphemes: piece.graphemes.map(\.rect)))
            }
            lead.append(piece)
        }
        let backing = backingPlaced.map { sub in
            sub.map { p in
                LyricPiece(
                    text: p.text,
                    rect: CGRect(
                        x: p.x + (alignEnd ? boxW - p.rowW : 0), y: top(p.row, bRowH, bMetrics), width: p.w,
                        height: bMetrics.ascent + bMetrics.descent))
            }
        }
        return LyricLineLayout(
            box: LyricLineBox(w: boxW, h: y, side: boxSide, words: wordBoxes), rtl: rtl, cjk: cjk, size: em,
            lead: lead, timed: timed, backing: backing,
            backingTimed: backingTexts.map { ($0.words?.isEmpty ?? true) == false })
    }

    /// Timed words as units: syllables of one word (`isPartOfWord`) stay together, and a space
    /// follows a word; in CJK every character is its own unit and may break anywhere.
    private static func units(_ words: [LyricWord], cjk: Bool, rtl: Bool, size: Double, ruler: Ruler) -> [Unit] {
        var out: [Unit] = []
        var group: [LyricWord] = []
        for (k, w) in words.enumerated() {
            group.append(w)
            let last = k == words.count - 1
            guard cjk || !w.isPartOfWord || last else { continue }
            let joined = group.map(\.text).joined()
            let gw = ruler.width(joined, size)
            var parts: [(text: String, x: Double, w: Double)] = []
            var prefix = ""
            for s in group {
                let before = prefix.isEmpty ? 0 : ruler.width(prefix, size)
                prefix += s.text
                let after = ruler.width(prefix, size)
                let x = rtl ? gw - after : before
                parts.append((text: s.text, x: x, w: max(0, after - before)))
            }
            out.append(Unit(parts: parts, w: gw, space: !w.isPartOfWord && !last))
            group = []
        }
        return out
    }

    /// Untimed text as units: its words (CJK: its characters).
    private static func units(text: String, cjk: Bool, size: Double, ruler: Ruler) -> [Unit] {
        let tokens = cjk ? text.filter { !$0.isWhitespace }.map(String.init) : text.split(whereSeparator: \.isWhitespace).map(String.init)
        return tokens.enumerated().map { k, t -> Unit in
            let w = ruler.width(t, size)
            return Unit(parts: [(text: t, x: 0, w: w)], w: w, space: !cjk && k < tokens.count - 1)
        }
    }

    /// Greedy rows within `maxW` at `scale`, then (text-wrap: pretty) a last row of one word takes
    /// one more from the row above when it fits.
    private static func rows(_ units: [Unit], scale: Double, maxW: Double, spaceW: Double) -> [[Int]] {
        var rows: [[Int]] = [[]]
        var x = 0.0
        for (k, u) in units.enumerated() {
            let w = u.w * scale
            if let last = rows[rows.count - 1].last {
                let gap = units[last].space ? spaceW * scale : 0
                if x + gap + w > maxW + 0.5 {
                    rows.append([k])
                    x = w
                } else {
                    rows[rows.count - 1].append(k)
                    x += gap + w
                }
            } else {
                rows[rows.count - 1].append(k)
                x = w
            }
        }
        if rows.count >= 2, rows[rows.count - 1].count == 1, rows[rows.count - 2].count >= 2,
           let moved = rows[rows.count - 2].last
        {
            let tail = [moved] + rows[rows.count - 1]
            if width(of: tail, units, scale: scale, spaceW: spaceW) <= maxW + 0.5 {
                rows[rows.count - 2].removeLast()
                rows[rows.count - 1] = tail
            }
        }
        return rows.filter { !$0.isEmpty }
    }

    private static func width(of row: [Int], _ units: [Unit], scale: Double, spaceW: Double) -> Double {
        var w = 0.0
        for (n, u) in row.enumerated() {
            w += units[u].w * scale
            if n < row.count - 1, units[u].space { w += spaceW * scale }
        }
        return w
    }

    // MARK: - Measuring

    /// The face's measurements, by size, cached for one layout.
    private final class Ruler {
        let style: LyricStyle
        private var fonts: [Double: CTFont] = [:]
        private var widths: [String: Double] = [:]

        init(style: LyricStyle) {
            self.style = style
        }

        func font(_ size: Double) -> CTFont {
            if let f = fonts[size] { return f }
            let f = style.font(size)
            fonts[size] = f
            return f
        }

        /// The typographic width of `text` at `size` points, tracking included.
        func width(_ text: String, _ size: Double) -> Double {
            let key = "\(size)|\(text)"
            if let w = widths[key] { return w }
            let attributes: [NSAttributedString.Key: Any] = [
                NSAttributedString.Key(kCTFontAttributeName as String): font(size),
                NSAttributedString.Key(kCTKernAttributeName as String): style.face.tracking * size,
            ]
            let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
            let w = Double(CTLineGetTypographicBounds(line, nil, nil, nil))
            widths[key] = w
            return w
        }

        func metrics(_ size: Double) -> (ascent: Double, descent: Double) {
            let f = font(size)
            return (Double(CTFontGetAscent(f)), Double(CTFontGetDescent(f)))
        }
    }
}
