import CoreGraphics
import Foundation
import Testing

// How lyric lines are set (LYRICS_EXPERIENCE.md §3.3, §4.3, §5.4–§5.6), against the web's own cases
// (src/client/stage/lyrics/layout.test.ts), and the CoreText layout itself on the fixtures: rows,
// reading order, held words letter by letter, right-to-left lines, a duet's second voice.

private func word(_ text: String, _ dur: Double) -> LyricWord {
    LyricWord(text: text, start: 10_000, end: 10_000 + dur)
}

@Suite("Lyrics: layout")
struct LyricsLayoutTests {
    // MARK: Fitting (§3.3)

    @Test("A line that fits in two rows keeps its size, measured once")
    func fits() {
        var seen: [Double] = []
        let fit = LyricText.fit { s in
            seen.append(s)
            return 2
        }
        #expect(fit.size == 1 && fit.rows == 2)
        #expect(seen == [1])
    }

    @Test("Shrinks by at most 12%, then allows three rows")
    func shrinks() {
        let a = LyricText.fit { s in s <= 0.94 ? 2 : 3 }
        #expect(a.size == 0.94 && a.rows == 2)
        var seen: [Double] = []
        let b = LyricText.fit { s in
            seen.append(s)
            return 3
        }
        #expect(b.size == 0.88 && b.rows == 3)
        #expect(abs((seen.min() ?? 0) - 0.88) < 1e-9)
    }

    // MARK: Held words (§5.5, LYR-09)

    @Test("Emphasis needs ≥ 1000 ms and 2–7 graphemes")
    func emphasisNeeds() {
        #expect(LyricText.emphasis(word("home", 999), last: false) == nil)
        #expect(LyricText.emphasis(word("home", 1000), last: false) != nil)
        #expect(LyricText.emphasis(word("a", 2000), last: false) == nil)
        #expect(LyricText.emphasis(word("ab", 2000), last: false) != nil)
        #expect(LyricText.emphasis(word("sevenly", 2000), last: false) != nil)
        #expect(LyricText.emphasis(word("eightish", 2000), last: false) == nil)
    }

    @Test("Never in joined scripts (Arabic, Syriac, N'Ko); Hebrew does not join")
    func joined() {
        #expect(LyricText.emphasis(word("مرحبا", 1500), last: false) == nil)
        #expect(LyricText.emphasis(word("ܫܠܡܐ", 1500), last: false) == nil)
        #expect(LyricText.emphasis(word("ߒߞߏ", 1500), last: false) == nil)
        #expect(LyricText.emphasis(word("שלום", 1500), last: false) != nil)
    }

    @Test("Counts graphemes, not code units")
    func graphemes() {
        #expect(LyricText.graphemes("café").count == 4)
        #expect(LyricText.graphemes("cafe\u{301}").count == 4) // é decomposed
        #expect(LyricText.graphemes("straße").count == 6)
        #expect(LyricText.emphasis(word("ééééééé", 2000), last: false) != nil)
    }

    @Test("CJK: duration only, even for one character")
    func cjkEmphasis() {
        #expect(LyricText.emphasis(word("光", 1200), last: false) != nil)
        #expect(LyricText.emphasis(word("光", 900), last: false) == nil)
    }

    @Test("Swell = 0.05·a, a = min(1.2, (dur − 1000)/1500 + 0.6); the last word ×1.4; capped at 8%")
    func swell() throws {
        func e(_ dur: Double, _ last: Bool) throws -> LyricEmphasis {
            try #require(LyricText.emphasis(word("home", dur), last: last))
        }
        let a = try e(1000, false)
        let b = try e(2500, false)
        let c = try e(9000, false)
        let d = try e(1000, true)
        let f = try e(9000, true)
        let g = try e(2000, false)
        #expect(abs(a.swell - 0.03) < 1e-9)
        // a = min(1.2, 1.6): already at its cap (the web's case says 0.055 within its 0.005).
        #expect(abs(b.swell - 0.06) < 1e-9)
        #expect(abs(c.swell - 0.06) < 1e-9)
        #expect(abs(d.swell - 0.042) < 1e-9)
        #expect(f.swell == 0.08)
        #expect(g.lift <= 0.08)
        #expect(abs(g.stepMs - 2000 / 2.5 / 4) < 1e-9)
    }

    @Test("On every fixture: never under 150 ms (rap), never past the caps")
    func emphasisCaps() {
        var count = 0
        for name in timedLyricFixtures + ["static"] {
            for l in lyricFixture(name).lines {
                let ws = l.words ?? []
                for (k, w) in ws.enumerated() {
                    guard let e = LyricText.emphasis(w, last: k == ws.count - 1) else { continue }
                    count += 1
                    #expect(w.end - w.start >= 1000)
                    #expect(e.swell <= 0.08 && e.lift <= 0.08)
                }
            }
        }
        #expect(count > 5) // the ballad's held words qualify
        let rap = lyricFixture("rap-word").lines.flatMap { $0.words ?? [] }
        #expect(rap.contains { $0.end - $0.start < 150 })
        for w in rap where w.end - w.start < 150 { #expect(LyricText.emphasis(w, last: true) == nil) }
    }

    // MARK: Scripts and sides (§4.3, §5.4, §5.6)

    @Test("The direction from the first strong character")
    func direction() {
        #expect(LyricText.direction("Hello") == .ltr)
        #expect(LyricText.direction("— שלום world") == .rtl)
        #expect(LyricText.direction("42 مرحبا") == .rtl)
        #expect(LyricText.direction("“Hi” שלום") == .ltr)
        #expect(lyricFixture("rtl-line").lines.allSatisfy { LyricText.direction($0.text) == .rtl })
    }

    @Test("CJK detection")
    func cjk() {
        #expect(lyricFixture("cjk-word").lines.allSatisfy { LyricText.isCJK($0.text) })
        #expect(!LyricText.isCJK("Ça ira, ﬁne"))
    }

    @Test("Backing vocals in parentheses, in line-synced text")
    func backing() {
        let a = LyricText.splitBacking("Hold on (hold on) to me")
        #expect(a.lead == "Hold on to me" && a.backing == ["hold on"])
        let b = LyricText.splitBacking("(only backing)")
        #expect(b.lead == "(only backing)" && b.backing.isEmpty)
        let c = LyricText.splitBacking("plain")
        #expect(c.lead == "plain" && c.backing.isEmpty)
    }

    @Test("A duet: each voice keeps its side for the whole song; the group is centred")
    func duet() {
        let doc = lyricFixture("duet-word")
        let side = LyricText.sides(doc)
        var by: [String: Set<String>] = [:]
        for l in doc.lines { by[l.agent ?? "", default: []].insert("\(side(l))") }
        #expect(by["v1"] == ["left"])
        #expect(by["v2"] == ["right"])
        #expect(by["v3"] == ["centre"])
        let ballad = lyricFixture("ballad-word")
        #expect(LyricText.sides(ballad)(ballad.lines[0]) == .centre)
    }

    @Test("Two voices without flags: the first left, the second right")
    func twoAgents() {
        var doc = lyricFixture("pop-line")
        doc.lines = [LyricLine(text: "a", start: 0, agent: "x"), LyricLine(text: "b", start: 1, agent: "y")]
        let side = LyricText.sides(doc)
        #expect(doc.lines.map(side) == [.left, .right])
    }

    // MARK: The CoreText layout

    private static let phone = 393.0
    private static let style = LyricStyle.echo(palette: nil, size: 30)

    private static func laid(_ name: String, width: Double = phone) -> (LyricTimeline, LyricDocLayout) {
        let doc = lyricFixture(name)
        let tl = LyricTimeline(doc)
        return (tl, LyricTypesetter.layout(doc, lines: tl.lines, width: width, style: style))
    }

    @Test("Ballad on an iPhone: every word set in reading order, in rows of the size's height, within the column")
    func readingOrder() {
        let (tl, doc) = Self.laid("ballad-word")
        let maxW = LyricsConfig.maxWidth * Self.phone
        #expect(doc.lines.count == tl.lines.count)
        for (i, line) in doc.lines.enumerated() {
            #expect(line.timed)
            #expect(line.lead.count == tl.lines[i].words?.count)
            #expect(line.lead.map(\.text) == (tl.lines[i].words ?? []).map(\.text))
            let row = line.size * Self.style.face.lineHeight
            let rows = (line.box.h / row).rounded()
            #expect(abs(line.box.h - rows * row) < 0.01, "line \(i)")
            #expect(rows >= 1 && rows <= 3, "line \(i): \(rows) rows")
            #expect(line.box.w <= maxW + 1, "line \(i)")
            #expect(line.size <= Self.style.face.size && line.size >= Self.style.face.size * 0.88 - 1e-9)
            for (k, p) in line.lead.enumerated() {
                #expect(p.rect.minX >= -0.01 && p.rect.maxX <= line.box.w + 0.01, "line \(i) word \(k)")
                // The face's ascent and descent are centred in the row and may reach past it (CSS's
                // half-leading), as the web's glyph boxes do.
                #expect(p.rect.midY > 0 && p.rect.midY < line.box.h, "line \(i) word \(k)")
                guard k > 0 else { continue }
                let q = line.lead[k - 1]
                // Later words sit later on the same row, or on a row below.
                #expect(p.rect.minY > q.rect.minY + 0.01 || (abs(p.rect.minY - q.rect.minY) < 0.01 && p.rect.minX >= q.rect.maxX - 0.01))
            }
        }
    }

    @Test("A held word is set letter by letter, its letters spanning it")
    func heldLetters() {
        let (tl, doc) = Self.laid("ballad-word")
        var found = 0
        for (i, line) in doc.lines.enumerated() {
            let words = tl.lines[i].words ?? []
            for (k, box) in line.box.words.enumerated() {
                let e = LyricText.emphasis(words[k], last: k == words.count - 1)
                #expect((box.emphasis != nil) == (e != nil))
                guard box.emphasis != nil else {
                    #expect(box.graphemes.isEmpty)
                    continue
                }
                found += 1
                let letters = line.lead[k].graphemes
                #expect(letters.count == LyricText.graphemes(words[k].text).count)
                #expect(abs((letters.first?.rect.minX ?? 0) - box.rect.minX) < 0.01)
                #expect(abs((letters.last?.rect.maxX ?? 0) - box.rect.maxX) < 1.5)
            }
        }
        #expect(found > 5)
    }

    @Test("Syllables of a word stay together, with no space between them")
    func syllables() {
        let (tl, doc) = Self.laid("ballad-word")
        for (i, line) in doc.lines.enumerated() {
            let words = tl.lines[i].words ?? []
            for k in words.indices.dropLast() where words[k].isPartOfWord {
                let (a, b) = (line.lead[k].rect, line.lead[k + 1].rect)
                #expect(abs(a.minY - b.minY) < 0.01, "line \(i)") // never broken between rows
                #expect(abs(b.minX - a.maxX) < 0.01, "line \(i)") // joined
            }
        }
    }

    @Test("Right to left: the words run from the right, the line at the column's end")
    func rightToLeft() {
        let (_, doc) = Self.laid("rtl-line")
        for line in doc.lines {
            #expect(line.rtl)
            #expect(line.box.side == .right)
            #expect(!line.timed)
            let firstRow = line.lead.filter { abs($0.rect.minY - (line.lead.first?.rect.minY ?? 0)) < 0.01 }
            for k in firstRow.indices.dropFirst() { #expect(firstRow[k].rect.maxX <= firstRow[k - 1].rect.minX + 0.01) }
            #expect(abs((firstRow.first?.rect.maxX ?? 0) - line.box.w) < 0.5)
        }
    }

    @Test("A duet's second voice ends at the column's end; backing vocals sit under their line")
    func duetLayout() {
        let (tl, doc) = Self.laid("duet-word", width: 1000)
        for (i, line) in doc.lines.enumerated() {
            let l = tl.lines[i]
            if l.oppositeAligned { #expect(line.box.side == .right) }
            let backing = l.background ?? []
            #expect(line.backing.count == backing.count)
            guard let lowest = line.lead.map(\.rect.midY).max() else { continue }
            for row in line.backing {
                for p in row {
                    #expect(p.rect.midY > lowest)
                    #expect(p.rect.height < (line.lead.first?.rect.height ?? 0))
                }
            }
        }
    }

    @Test("A line-synced line is set as its words, one wash along them; its backing vocals too")
    func lineSynced() {
        let (tl, doc) = Self.laid("pop-line")
        for (i, line) in doc.lines.enumerated() {
            #expect(!line.timed)
            #expect(line.box.words.isEmpty)
            #expect(line.lead.map(\.text).joined(separator: " ") == LyricText.splitBacking(tl.lines[i].text).lead)
        }
    }
}
