import SwiftUI

// The lyric field drawn (LYRICS_EXPERIENCE.md §3–§9; the web's field.ts and stage.css): the model
// (Lyrics/LyricField.swift) moves the lines each frame of a TimelineView, and each line is a view
// of its own whose words are laid where CoreText measured them, so a line that only travels (a
// hand-over's springs) moves as one layer and is not drawn again. Its words are drawn again only
// when their light changes: the word being sung, the sweep's soft edge, the glow, a held word's
// letters.

/// What the field needs from the player each frame.
struct LyricClock {
    /// The lyrics' time, ms: what is heard (the output's latency off), less the user's offsets.
    var ms: Double
    var playing: Bool
    /// The scrubber is held: lines take their places for its time at once (§9.6).
    var scrubbing: Bool
}

/// How a word is lit.
enum LyricInk: Equatable {
    case unlit, lit
    /// The soft edge is on it: how far it is through the word (past either end while its fade
    /// still covers it).
    case sweep(Double)
}

/// A line's light, rounded so a line whose light does not change compares equal frame to frame.
struct LyricInks: Equatable {
    var mix: Double
    var fade: Double
    var lead: [LyricInk]
    var backing: [[LyricInk]]
    var glow: [Double]
    var glowR: Double
    var wy: [Double]
    var ws: [Double]
    var emph: [[Double]]
}

struct LyricLineFrame: Identifiable, Equatable {
    /// The line's instance (a line that leaves and comes back is a new one).
    var id: Int
    var index: Int
    var x: Double
    var y: Double
    var scale: Double
    var opacity: Double
    var blur: Double
    var inks: LyricInks
}

struct LyricFrame {
    var layout: LyricDocLayout
    var lines: [LyricLineFrame]
    var dots: LyricDots
    var width: Double
    var height: Double
    /// The line being sung, for VoiceOver.
    var activeText: String?
}

/// The field's state across frames: the layout (set again for another document, style or width)
/// and the model.
@MainActor
final class LyricFieldEngine {
    private var docID = ""
    private var style: LyricStyle?
    private var width = 0.0
    private var layout: LyricDocLayout?
    private var model: LyricFieldModel?
    private var lastDate: Date?

    func frame(
        doc: LyricsDoc, style: LyricStyle, width: Double, height: Double, date: Date, clock: LyricClock,
        reduced: Bool
    ) -> LyricFrame {
        if doc.id != docID || style != self.style || abs(width - self.width) > 0.5 || layout == nil || model == nil {
            let sameDoc = doc.id == docID && model != nil
            let timeline = sameDoc ? (model?.tl ?? LyricTimeline(doc)) : LyricTimeline(doc)
            let laid = LyricTypesetter.layout(doc, lines: timeline.lines, width: width, style: style)
            if sameDoc, let model {
                model.relayout(laid.lines.map(\.box))
            } else {
                model = LyricFieldModel(timeline, boxes: laid.lines.map(\.box), dotsH: laid.rowH)
                lastDate = nil
            }
            layout = laid
            docID = doc.id
            self.style = style
            self.width = width
        }
        let dt = lastDate.map { min(100, max(0, date.timeIntervalSince($0) * 1000)) } ?? 0
        lastDate = date
        guard let model, let layout else {
            return LyricFrame(
                layout: LyricDocLayout(size: style.face.size, rowH: 0, width: width, lines: []), lines: [],
                dots: LyricDots(), width: width, height: height, activeText: nil)
        }
        model.update(LyricFrameInput(
            t: clock.ms, dt: dt, playing: clock.playing, mode: clock.scrubbing ? .scrub : .run, W: width, H: height,
            reduced: reduced))
        var lines: [LyricLineFrame] = []
        let current = model.insts.values.sorted { $0.i < $1.i }
        for inst in current + model.leaving where inst.i < layout.lines.count {
            let lay = layout.lines[inst.i]
            lines.append(LyricLineFrame(
                id: inst.serial, index: inst.i, x: inst.x.x, y: inst.y.x, scale: inst.scale,
                opacity: (inst.opacity * 1000).rounded() / 1000, blur: (inst.blur * 100).rounded() / 100,
                inks: Self.inks(inst, lay, style)))
        }
        let active = model.active
        return LyricFrame(
            layout: layout, lines: lines, dots: model.dots, width: width, height: height,
            activeText: active >= 0 && active < model.lines.count ? model.lines[active].text : nil)
    }

    /// The line `index` of the last frame's document.
    func line(_ index: Int) -> LyricLine? {
        guard let model, index >= 0, index < model.lines.count else { return nil }
        return model.lines[index]
    }

    private static func inks(_ inst: LyricInst, _ lay: LyricLineLayout, _ style: LyricStyle) -> LyricInks {
        let em = lay.size
        func ink(_ p: Double, _ w: Double, _ em: Double) -> LyricInk {
            let ww = max(1, w)
            if p <= -style.edgeAhead * em / ww { return .unlit }
            if p >= 1 + style.edgeBehind * em / ww { return .lit }
            return .sweep((p * 1000).rounded() / 1000)
        }
        // A line-synced line: one wash along its words laid end to end (§9.2).
        func wash(_ pieces: [LyricPiece], _ em: Double) -> [LyricInk] {
            if inst.wash >= 1 { return pieces.map { _ in .lit } }
            if inst.wash <= 0 { return pieces.map { _ in .unlit } }
            let total = pieces.reduce(0.0) { $0 + Double($1.rect.width) }
            var x = 0.0
            return pieces.map { piece -> LyricInk in
                let w = Double(piece.rect.width)
                let p = (inst.wash * total - x) / max(1, w)
                x += w
                return ink(p, w, em)
            }
        }
        let lead: [LyricInk] = lay.timed
            ? lay.lead.indices.map { k in
                ink(k < inst.edge.count ? inst.edge[k] : LyricFieldModel.unreached, Double(lay.lead[k].rect.width), em)
            }
            : wash(lay.lead, em)
        let bem = em * LyricTypesetter.backingSize
        let backing: [[LyricInk]] = lay.backing.indices.map { j in
            let pieces = lay.backing[j]
            if !lay.timed { return wash(pieces, bem) }
            guard j < lay.backingTimed.count, lay.backingTimed[j], j < inst.backing.count else {
                return pieces.map { _ in .unlit }
            }
            let edges = inst.backing[j]
            return pieces.indices.map { k in
                ink(k < edges.count ? edges[k] : LyricFieldModel.unreached, Double(pieces[k].rect.width), bem)
            }
        }
        func q(_ v: Double, _ step: Double) -> Double { (v / step).rounded() * step }
        return LyricInks(
            mix: q(inst.mix, 0.01), fade: inst.fade > 0.995 ? 1 : q(inst.fade, 0.01), lead: lead, backing: backing,
            glow: inst.glow.map { q($0, 0.004) }, glowR: q(inst.glowR, 0.005), wy: inst.wy.map { q($0, 0.0005) },
            ws: inst.ws.map { q($0, 0.0005) }, emph: inst.emph.map { row in row.map { q($0.x, 0.002) } })
    }
}

/// The lyric field: the column at the song's time, over the room; a tap on a line plays from it.
/// The stage starts `top` points down and ends `bottom` points above the view's end, the anchor at
/// 40% of it; the column runs past both under the glass, fading.
struct LyricFieldView: View {
    let doc: LyricsDoc
    let style: LyricStyle
    var top: CGFloat
    var bottom: CGFloat
    var reduced: Bool
    /// Animating; false holds the last frame (paused and settled).
    var running = true
    /// Settings → Lyrics → Announce lyric lines: each line is spoken to VoiceOver as it begins.
    var announce = false
    let clock: @MainActor () -> LyricClock
    let onLine: @MainActor (LyricLine) -> Void

    @State private var engine = LyricFieldEngine()

    var body: some View {
        GeometryReader { geo in
            let height = max(1, geo.size.height - top - bottom)
            TimelineView(.animation(minimumInterval: nil, paused: !running)) { context in
                let frame = engine.frame(
                    doc: doc, style: style, width: geo.size.width, height: height, date: context.date, clock: clock(),
                    reduced: reduced)
                LyricColumn(frame: frame, style: style, top: top) { index in
                    if let line = engine.line(index) { onLine(line) }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Lyrics")
                .accessibilityValue(frame.activeText ?? "")
                .onChange(of: frame.activeText) { old, new in
                    if let line = LyricAnnouncement.line(from: old, to: new, enabled: announce) {
                        AccessibilityNotification.Announcement(line).post()
                    }
                }
            }
            .mask { fade(geo.size.height) }
        }
    }

    /// No hard edge where the column runs under the glass: it fades in below the top and out above
    /// the bottom.
    private func fade(_ h: CGFloat) -> some View {
        let total = max(1, h)
        let a = min(0.45, max(0.02, (top - 30) / total))
        let b = min(0.5, max(a + 0.01, (top + 30) / total))
        let d = max(b + 0.02, min(0.99, (total - bottom * 0.45) / total))
        let c = max(b + 0.01, min(d - 0.01, (total - bottom - 24) / total))
        return LinearGradient(
            stops: [
                .init(color: .clear, location: a), .init(color: .black, location: b), .init(color: .black, location: c),
                .init(color: .clear, location: d),
            ],
            startPoint: .top, endPoint: .bottom)
    }
}

/// One frame of the column.
struct LyricColumn: View {
    let frame: LyricFrame
    let style: LyricStyle
    let top: CGFloat
    let onTap: @MainActor (Int) -> Void

    var body: some View {
        let layout = frame.layout
        ZStack(alignment: .topLeading) {
            ForEach(frame.lines) { line in
                if line.index < layout.lines.count {
                    let lay = layout.lines[line.index]
                    let end = lay.box.side == .right || lay.rtl
                    LyricLineView(layout: lay, inks: line.inks, style: style)
                        .frame(width: lay.box.w, height: lay.box.h, alignment: .topLeading)
                        .contentShape(.rect)
                        .onTapGesture { onTap(line.index) }
                        .scaleEffect(line.scale, anchor: end ? .trailing : .leading)
                        .blur(radius: line.blur * style.depthBlur)
                        .opacity(line.opacity)
                        .offset(x: line.x - lay.box.w / 2, y: Double(top) + line.y - lay.box.h / 2)
                }
            }
            if frame.dots.opacity > 0 {
                dots(layout)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// The interlude dots at the anchor, where the column starts (§9.8).
    private func dots(_ layout: LyricDocLayout) -> some View {
        let d = LyricsConfig.Interlude.dotEm * layout.size
        let inset = (1 - LyricsConfig.maxWidth) / 2 * frame.width
        return HStack(spacing: d) {
            ForEach(0..<3, id: \.self) { k in
                Circle()
                    .fill(Color(style.ink))
                    .frame(width: d, height: d)
                    .scaleEffect(frame.dots.scale[k])
                    .opacity(frame.dots.alpha[k])
            }
        }
        .opacity(frame.dots.opacity)
        .offset(x: inset, y: Double(top) + LyricsConfig.anchorY * frame.height - d / 2)
        .accessibilityHidden(true)
    }
}

/// A line's words where the layout put them, lit as `inks` says: the sweep's gradient on the word
/// it crosses (lit, then the bright edge, then unlit), the word being sung lifted and swollen, the
/// glow behind it, a held word letter by letter, and the backing vocals under it.
///
/// Its three inputs are equatable values, so SwiftUI draws it again only when one changes (a line
/// that only travels keeps its words as they were).
struct LyricLineView: View {
    let layout: LyricLineLayout
    let inks: LyricInks
    let style: LyricStyle

    var body: some View {
        let em = layout.size
        let colours = Colours(
            unlit: Color(style.unlit(inks.mix)), lit: Color(style.lit(fade: inks.fade, secondVoice: layout.box.side == .right)),
            edge: Color(style.edge), glow: Color(style.glow))
        let font = LyricFonts.font(style, em)
        let backingFont = LyricFonts.font(style, em * LyricTypesetter.backingSize)
        ZStack(alignment: .topLeading) {
            ForEach(layout.lead.indices, id: \.self) { k in
                leadWord(k, em: em, font: font, colours: colours)
            }
            ForEach(layout.backing.indices, id: \.self) { j in
                ForEach(layout.backing[j].indices, id: \.self) { k in
                    let piece = layout.backing[j][k]
                    let ink = j < inks.backing.count && k < inks.backing[j].count ? inks.backing[j][k] : .unlit
                    word(
                        piece.text, font: backingFont, em: em * LyricTypesetter.backingSize,
                        fill: fill(ink, width: piece.rect.width, em: em * LyricTypesetter.backingSize, colours))
                        .offset(x: piece.rect.minX, y: piece.rect.minY)
                }
            }
            .opacity(0.55)
        }
    }

    private struct Colours {
        var unlit: Color
        var lit: Color
        var edge: Color
        var glow: Color
    }

    @ViewBuilder
    private func leadWord(_ k: Int, em: Double, font: Font, colours: Colours) -> some View {
        let piece = layout.lead[k]
        let ink = k < inks.lead.count ? inks.lead[k] : .unlit
        let wy = k < inks.wy.count ? inks.wy[k] : 0
        let ws = k < inks.ws.count ? inks.ws[k] : 1
        let glow = k < inks.glow.count ? inks.glow[k] : 0
        let emph = k < inks.emph.count ? inks.emph[k] : []
        let radius = inks.glowR * em * style.glowScale
        let emphasis = k < layout.box.words.count ? layout.box.words[k].emphasis : nil
        if let emphasis, !piece.graphemes.isEmpty, emph.count == piece.graphemes.count {
            // A held word, letter by letter (§5.5): each lifts and swells in turn, and they push a
            // little apart from the word's middle (mirrored right to left).
            let mid = Double(piece.graphemes.count - 1) / 2
            let side: Double = layout.rtl ? -1 : 1
            ForEach(piece.graphemes.indices, id: \.self) { g in
                let letter = piece.graphemes[g]
                let v = emph[g]
                let off = layout.rtl ? piece.rect.maxX - letter.rect.maxX : letter.rect.minX - piece.rect.minX
                word(letter.text, font: font, em: em, fill: fill(letterInk(ink, piece, off, letter.rect.width, em), width: letter.rect.width, em: em, colours))
                    .modifier(LyricGlow(alpha: glow, radius: radius, colour: colours.glow))
                    .scaleEffect(1 + emphasis.swell * v, anchor: UnitPoint(x: 0.5, y: 0.8))
                    .offset(
                        x: Double(letter.rect.minX) + side * emphasis.spread * v * (Double(g) - mid) * em,
                        y: Double(letter.rect.minY) + (wy - emphasis.lift * v) * em)
            }
        } else {
            word(piece.text, font: font, em: em, fill: fill(ink, width: piece.rect.width, em: em, colours))
                .modifier(LyricGlow(alpha: glow, radius: radius, colour: colours.glow))
                .scaleEffect(ws, anchor: UnitPoint(x: 0.5, y: 0.75))
                .offset(x: piece.rect.minX, y: Double(piece.rect.minY) + wy * em)
        }
    }

    /// A held word's letter: the word's edge, measured through this letter.
    private func letterInk(_ ink: LyricInk, _ piece: LyricPiece, _ off: CGFloat, _ w: CGFloat, _ em: Double) -> LyricInk {
        guard case .sweep(let p) = ink else { return ink }
        let gp = (p * Double(piece.rect.width) - Double(off)) / max(1, Double(w))
        if gp <= -style.edgeAhead * em / max(1, Double(w)) { return .unlit }
        if gp >= 1 + style.edgeBehind * em / max(1, Double(w)) { return .lit }
        return .sweep(gp)
    }

    private func word(_ text: String, font: Font, em: Double, fill: AnyShapeStyle) -> some View {
        Text(text)
            .font(font)
            .kerning(style.face.tracking * em)
            .foregroundStyle(fill)
            .lineLimit(1)
            .fixedSize()
    }

    /// The sweep (§5.1): lit up to 0.6 em behind the edge, the highlight at it, unlit from 0.35 em
    /// ahead; right to left in a right-to-left line.
    private func fill(_ ink: LyricInk, width: CGFloat, em: Double, _ c: Colours) -> AnyShapeStyle {
        switch ink {
        case .unlit:
            return AnyShapeStyle(c.unlit)
        case .lit:
            return AnyShapeStyle(c.lit)
        case .sweep(let p):
            let w = max(1, Double(width))
            let e = p * w
            let a = e - style.edgeBehind * em
            let b = e + style.edgeAhead * em
            let k = (e - a) / max(0.001, b - a)
            let start = layout.rtl ? (w - a) / w : a / w
            let end = layout.rtl ? (w - b) / w : b / w
            return AnyShapeStyle(
                LinearGradient(
                    stops: [
                        Gradient.Stop(color: c.lit, location: 0), Gradient.Stop(color: c.edge, location: k),
                        Gradient.Stop(color: c.unlit, location: 1),
                    ],
                    startPoint: UnitPoint(x: start, y: 0.5), endPoint: UnitPoint(x: end, y: 0.5)))
        }
    }
}

/// The glow behind the word being sung (§5.2): a shadow of the painted letters, so it never veils
/// the sweep; none when it has faded out.
struct LyricGlow: ViewModifier {
    let alpha: Double
    let radius: Double
    let colour: Color

    @ViewBuilder
    func body(content: Content) -> some View {
        if alpha > 0.003 {
            content.shadow(color: colour.opacity(alpha), radius: radius)
        } else {
            content
        }
    }
}

/// The lyric face by size, made once.
@MainActor
enum LyricFonts {
    private static var cache: [String: Font] = [:]

    static func font(_ style: LyricStyle, _ size: Double) -> Font {
        let key = "\(style.face.name ?? "system")|\(style.face.weight)|\((size * 100).rounded())"
        if let font = cache[key] { return font }
        let font = Font(style.font(size))
        cache[key] = font
        return font
    }
}

extension EnvironmentValues {
    /// The lyric style the screens use: ECHO's, or a theme's (task 11 sets it).
    @Entry var lyricLook: LyricLook = .echo
    /// The `-ECHODemo lyrics-menu` screen: the lyrics menu opens with the lyrics.
    @Entry var lyricsMenuOnOpen: Bool = false
}

/// Which line VoiceOver is told about (Settings → Lyrics → Announce lyric lines).
enum LyricAnnouncement {
    /// The line that just began, when announcing is on; nil for no line, the same line, or off.
    static func line(from old: String?, to new: String?, enabled: Bool) -> String? {
        guard enabled, let new, new != old, !new.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return new
    }
}
