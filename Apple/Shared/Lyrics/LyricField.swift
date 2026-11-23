import Foundation

// The lyric field's motion, frame by frame (LYRICS_EXPERIENCE.md §4–§9; the web's
// src/client/stage/lyrics/model.ts, ported as it is): one column scrolled by springs from the
// song's time, the hand-over's stagger, the sung lines' fading colour, the word sweep with its one
// soft edge, the glow and its photosensitivity limit, held words' emphasis, the interlude dots.
// No drawing: the SwiftUI field draws what this works out, so all of it is tested on simulations.

enum LyricRole: Equatable, Sendable {
    /// The active line and those to come.
    case zone
    /// Sung lines, above them.
    case past
}

/// One line in the column.
final class LyricInst {
    let i: Int
    /// Unique to this instance (a line that leaves and comes back is a new one).
    let serial: Int
    var role: LyricRole
    var rank: Int
    var x: LyricSpring
    var y: LyricSpring
    /// The distance from the anchor, 0…1 (§4.1).
    var z: LyricSpring
    var params: SpringParams
    /// ms until this line's new targets apply (the stagger).
    var delay = 0.0
    var tx: Double
    var ty: Double
    var tz: Double
    /// ms since it entered, for its fade in.
    var age: Double
    var leaving: (ms: Double, age: Double, from: Double)? = nil
    // What the drawing reads:
    var scale = 1.0
    var opacity = 0.0
    /// Its own blur, points.
    var blur = 0.0
    /// The unsung ink toward the room (§5.1).
    var mix = 0.0
    /// Past lines: the lit colour toward the ink (§7).
    var fade = 0.0
    /// The sweep per lead word: the time through it, 0…1.
    var p: [Double] = []
    /// Where the line's soft edge is per lead word (lineEdges), for drawing.
    var edge: [Double] = []
    /// The same per backing word.
    var backing: [[Double]] = []
    /// A line-synced line's wash, 0…1.
    var wash = 0.0
    /// The glow's alpha per lead word.
    var glow: [Double] = []
    /// The glow's radius, em (§12.3).
    var glowR = LyricsConfig.Glow.radius
    /// Per lead word, per grapheme: 0 at rest … 1 full emphasis.
    var emph: [[LyricSpring]] = []
    /// Per lead word: how far below its rest it sits (em) and its scale (wordMotion).
    var wy: [Double] = []
    var ws: [Double] = []

    init(
        i: Int, serial: Int, role: LyricRole, rank: Int, x: Double, y: Double, z: Double, age: Double
    ) {
        self.i = i
        self.serial = serial
        self.role = role
        self.rank = rank
        self.x = LyricSpring(x)
        self.y = LyricSpring(y)
        self.z = LyricSpring(z)
        params = LyricSprings.slow
        tx = x
        ty = y
        tz = z
        self.age = age
    }
}

/// The interlude dots: the group's opacity, each dot's scale and alpha.
struct LyricDots: Equatable, Sendable {
    var opacity = 0.0
    var scale: [Double] = [1, 1, 1]
    var alpha: [Double] = [0, 0, 0]
}

struct LyricFrameInput {
    /// The song's time, ms.
    var t: Double
    /// Since the last frame, ms.
    var dt: Double
    var playing: Bool
    var mode: LyricFieldMode
    /// The stage, points.
    var W: Double
    var H: Double
    var features: LyricFeatures? = nil
    /// §10: crossfades in place, no travel, no beats or emphasis.
    var reduced = false
}

final class LyricFieldModel {
    let tl: LyricTimeline
    var lines: [LyricLine] { tl.lines }
    /// When each line leaves the anchor: the first span in which it is behind the field.
    let leftAt: [Double]
    let coalesced: Set<Int>
    private(set) var boxes: [LyricLineBox]
    /// The dots' box at rank 0 (one row at the active size).
    let dotsH: Double

    private(set) var insts: [Int: LyricInst] = [:]
    private(set) var leaving: [LyricInst] = []
    private(set) var dots = LyricDots()
    private(set) var beat: LyricBeatTerms? = nil
    private let beats = LyricBeat()
    private var lastT = Double.nan
    private var lastMode = LyricFieldMode.run
    private var lastField: LyricFieldState? = nil
    private var pause = 1.0
    private var reduced = false
    private var dotsLeave = 0.0
    private var serials = 0

    static let seekJumpMs = 150.0
    /// After a word ends with nothing right after it, its trailing fade clears over this long.
    static let settleMs = 250.0
    static let unreached = -1e6

    init(_ tl: LyricTimeline, boxes: [LyricLineBox], dotsH: Double) {
        self.tl = tl
        self.boxes = boxes
        self.dotsH = dotsH
        coalesced = Set(tl.coalesced)
        var left = Array(repeating: Double.infinity, count: tl.lines.count)
        for s in tl.spans {
            for j in 0..<min(s.next, left.count) where j != s.line && left[j] == .infinity {
                left[j] = s.from
            }
        }
        leftAt = left
    }

    /// The line being sung at the last update, or −1.
    var active: Int { lastField?.active ?? -1 }

    /// New measurements (a resize): everything jumps to its new place (§9.10).
    func relayout(_ boxes: [LyricLineBox]) {
        self.boxes = boxes
        lastT = .nan
    }

    // MARK: - A frame

    func update(_ f: LyricFrameInput) {
        let C = LyricsConfig.Column.self
        let t = f.t
        let dt = f.dt
        let first = lastT.isNaN
        let jumped = !first && f.mode != .scrub
            && (t < lastT - 1 || abs(t - (lastT + (f.playing ? dt : 0))) > Self.seekJumpMs)
        // A seek: targets jump and lines travel on the slow spring with no stagger. Leaving scrub
        // mode counts as one (§9.6).
        let seek = jumped || (lastMode == .scrub && f.mode != .scrub)
        reduced = f.reduced
        let direct = f.mode != .run || first || reduced
        lastT = t
        lastMode = f.mode

        let fs = tl.field(at: t)
        let prev = lastField
        lastField = fs
        let handover = prev.map { $0.active != fs.active || $0.next != fs.next } ?? false
        // §6.1: the slow spring after an interlude, for the first line and at the end of the song.
        let slowHandover = handover && (prev.map { $0.active < 0 } ?? false || fs.active < 0)
        let n = lines.count

        let ft = f.features ?? .silent
        let activeLine: LyricLine? = fs.active >= 0 ? lines[fs.active] : nil
        let beat = beats.update(LyricBeatInput(
            features: ft, dt: dt, sinceHandover: seek ? 0 : t - fs.from,
            vocal: LyricBeat.vocal(activeLine?.words, lineActive: activeLine != nil, mid: ft.mid, at: t),
            mode: f.mode, reduced: reduced))
        self.beat = beat

        let G = LyricsConfig.Glow.self
        let pauseTarget = f.playing ? 1 : G.paused
        let pauseRate = (1 - G.paused) / (f.playing ? G.resumeMs : G.pauseMs)
        if f.mode == .still {
            pause = pauseTarget
        } else if pause < pauseTarget {
            pause = min(pauseTarget, pause + pauseRate * dt)
        } else {
            pause = max(pauseTarget, pause - pauseRate * dt)
        }

        // ---- the column (§4) ----
        // The active line (or the dots' box) at the anchor; lines to come below it and sung lines
        // above it, one gap apart, while their slots are within the margin of the stage.
        let anchorY = LyricsConfig.anchorY * f.H
        let gap = C.gap * dotsH
        let h0 = fs.active >= 0 ? boxes[fs.active].h : dotsH
        var want: [(i: Int, role: LyricRole, rank: Int, y: Double)] = []
        var wanted: [Int: Double] = [:]
        func add(_ i: Int, _ role: LyricRole, _ rank: Int, _ y: Double) {
            want.append((i, role, rank, y))
            wanted[i] = y
        }
        if fs.active >= 0 { add(fs.active, .zone, 0, anchorY) }
        var edge = anchorY + h0 / 2
        var j = fs.next
        while j < n, edge < (1 + C.margin) * f.H {
            let h = boxes[j].h
            add(j, .zone, j - fs.next + 1, edge + gap + h / 2)
            edge += gap + h
            j += 1
        }
        edge = anchorY - h0 / 2
        j = min(fs.next, n) - 1
        var rank = -1
        while j >= 0, edge > -C.margin * f.H {
            if j != fs.active {
                let h = boxes[j].h
                add(j, .past, rank, edge - gap - h / 2)
                rank -= 1
                edge -= gap + h
            }
            j -= 1
        }

        let B = LyricsConfig.Build.self
        for (i, inst) in insts where wanted[i] == nil {
            insts[i] = nil
            if f.mode == .still { continue } // gone at once
            // A line scrolled out of the column fades in 120 ms (§7); a seek fades out what does
            // not belong to the new place in 160 ms (§9.6).
            inst.leaving = (seek ? B.seekOutMs : LyricsConfig.Decay.dropMs, 0, inst.opacity)
            leaving.append(inst)
        }

        func params(_ i: Int) -> SpringParams {
            if seek || slowHandover { return LyricSprings.slow }
            let a = fs.active >= 0 ? fs.active : i
            let next = a + 1 < n ? lines[a + 1].start : Double.infinity
            return LyricSprings.lineNormal(next - lines[a].start)
        }

        for w in want {
            let i = w.i
            let tx = anchorX(boxes[i], f.W)
            let ty = w.y
            let tz = min(1, Double(abs(w.rank)) * C.dz)
            let inst: LyricInst
            if let existing = insts[i] {
                inst = existing
                if inst.rank != w.rank || inst.role != w.role {
                    inst.params = params(i)
                    inst.delay = seek || direct ? 0 : Self.staggerMs(w.rank)
                    inst.role = w.role
                    inst.rank = w.rank
                } else if seek {
                    inst.params = LyricSprings.slow
                    inst.delay = 0
                }
            } else {
                // A line entering the column joins its neighbour where it is, delay and spring
                // included, so it scrolls in with it instead of waiting at its slot under a line
                // still on its way.
                let nb: LyricInst? = direct ? nil : insts[w.role == .past ? i + 1 : i - 1]
                var off = 0.0
                if let nb { off = nb.y.x - (wanted[nb.i] ?? nb.y.x) }
                inst = create(i, w.role, w.rank, tx, ty + off, tz, still: f.mode == .still)
                if let nb {
                    inst.y.v = nb.y.v
                    inst.delay = nb.delay
                    inst.params = nb.params
                }
                insts[i] = inst
            }

            inst.delay = max(0, inst.delay - dt)
            if inst.delay == 0 {
                inst.tx = tx
                inst.ty = ty
                inst.tz = tz
            }
            if direct {
                inst.x.snap(inst.tx)
                inst.y.snap(inst.ty)
                inst.z.snap(inst.tz)
            } else {
                inst.x.step(to: inst.tx, inst.params, dtMs: dt)
                inst.y.step(to: inst.ty, inst.params, dtMs: dt)
                inst.z.step(to: inst.tz, inst.params, dtMs: dt)
            }
            inst.age += f.mode == .still ? B.fadeInMs : dt
            let shown = inst.opacity
            style(inst, w.role, t, beat)
            // §10: a hand-over is a crossfade in place, so opacity eases at a fixed rate.
            if reduced, f.mode == .run {
                let r = LyricsConfig.Reduced.crossfadeMs
                inst.opacity = shown + lyricClamp(inst.opacity - shown, -dt / r, dt / r)
            }
            words(inst, t, f, settle: seek || direct)
        }

        for inst in leaving {
            guard var l = inst.leaving else { continue }
            l.age += dt
            inst.leaving = l
            inst.opacity = l.from * max(0, 1 - l.age / l.ms)
        }
        leaving.removeAll { inst in
            guard let l = inst.leaving else { return true }
            return l.age >= l.ms
        }

        updateDots(fs, t, dt, still: f.mode == .still)
    }

    /// The column's start edge, or its end for a duet's second voice (§4.3).
    private func anchorX(_ b: LyricLineBox, _ W: Double) -> Double {
        let inset = (1 - LyricsConfig.maxWidth) / 2 * W
        return b.side == .right ? W - inset - b.w / 2 : inset + b.w / 2
    }

    private func create(
        _ i: Int, _ role: LyricRole, _ rank: Int, _ x: Double, _ y: Double, _ z: Double, still: Bool
    ) -> LyricInst {
        serials += 1
        let inst = LyricInst(
            i: i, serial: serials, role: role, rank: rank, x: x, y: y, z: z,
            age: still ? LyricsConfig.Build.fadeInMs : 0)
        let words = lines[i].words ?? []
        let em = boxes[i].words
        inst.p = words.map { _ in 0 }
        inst.edge = words.map { _ in Self.unreached }
        inst.backing = (lines[i].background ?? []).map { b in (b.words ?? []).map { _ in Self.unreached } }
        inst.glow = words.map { _ in 0 }
        inst.emph = words.indices.map { k in
            k < em.count && em[k].emphasis != nil ? em[k].graphemes.map { _ in LyricSpring(0) } : []
        }
        inst.wy = words.map { _ in reduced ? 0 : LyricsConfig.Word.liftEm }
        inst.ws = words.map { _ in 1 }
        return inst
    }

    private func style(_ inst: LyricInst, _ role: LyricRole, _ t: Double, _ beat: LyricBeatTerms) {
        let z = inst.z.x
        let born = reduced ? 1 : lyricClamp(inst.age / LyricsConfig.Build.fadeInMs, 0, 1)
        inst.opacity = Self.opacity(at: z) * born
        inst.blur = Self.blur(at: z)
        // Beats change size only, never opacity or luminance (§12.4): the active line pulses.
        inst.scale = inst.rank == 0 ? 1 + beat.pulse : 1
        inst.mix = Self.unlitMix(at: z)
        // A sung line's lit colour dies into ink once it has left the anchor (§7).
        let left = leftAt[inst.i]
        inst.fade = role == .past ? 1 - exp(-max(0, t - left) / LyricsConfig.Decay.tauMs) : 0
    }

    private func words(_ inst: LyricInst, _ t: Double, _ f: LyricFrameInput, settle: Bool) {
        let G = LyricsConfig.Glow.self
        let line = lines[inst.i]
        let rank = inst.rank
        let words = line.words ?? []
        let boxes = self.boxes[inst.i].words
        for k in words.indices { inst.p[k] = Self.sweep(words[k], t) }
        inst.edge = Self.lineEdges(words, boxes.map { Double($0.rect.width) }, t)
        // Backing words are drawn with the same edge, on equal widths (the web's).
        for (j, b) in (line.background ?? []).enumerated() where j < inst.backing.count {
            inst.backing[j] = Self.lineEdges(b.words ?? [], [], t)
        }
        inst.wash = words.isEmpty ? Self.wash(line, t) : 0
        for k in words.indices {
            let m = reduced
                ? (y: 0.0, s: 1.0)
                : Self.wordMotion(words[k], t, emphasised: k < boxes.count && boxes[k].emphasis != nil)
            inst.wy[k] = m.y
            inst.ws[k] = m.s
        }

        // Glow (§5.2): the sweeping word of the line being sung (rank 0, or a line sweeping at +1).
        let sweeping = words.firstIndex { t >= $0.start && t < $0.end } ?? -1
        let lit = rank == 0 || (rank == 1 && sweeping >= 0)
        let slew = G.slewPerS / 1000 * f.dt
        let look = LyricBeat.glow(sustain: beat?.sustain ?? 0, add: beat?.glowAdd ?? 0)
        inst.glowR = look.radius
        let target = lit && sweeping >= 0 ? look.alpha * pause : 0
        let before = inst.glow
        // A faint glow ends at 0 only when that step is itself within the slew.
        func end(_ a: Double, _ next: Double) -> Double { next < 0.005 && a <= slew ? 0 : next }
        // Words that ended fade exponentially (τ 220 ms, 120 ms for fast words), never faster than
        // the photosensitivity slew (§12.5).
        var fading = 0
        for k in words.indices {
            let a = before[k]
            if (k == sweeping && target > 0) || a == 0 { continue }
            let w = words[k]
            let tau = w.end - w.start < 150 ? G.decayFastMs : G.decayMs
            let next = f.mode == .still ? 0 : max(a * exp(-f.dt / tau), a - slew)
            let g = end(a, next)
            inst.glow[k] = g
            if g > 0 { fading += 1 }
        }
        // At most two words glow (§5.2). While two are still fading, the older fades at the
        // fastest permitted rate and the sweeping word waits for it, so no glow is ever cut.
        let own = sweeping >= 0 && before[sweeping] > 0 ? 1 : 0
        if fading >= 2 || fading + own > 2,
           let oldest = inst.glow.indices.first(where: { inst.glow[$0] > 0 && $0 != sweeping })
        {
            let a = before[oldest]
            inst.glow[oldest] = end(a, max(0, a - slew))
        }
        if sweeping >= 0 {
            let a = before[sweeping]
            let room = inst.glow.indices.filter { inst.glow[$0] > 0 && $0 != sweeping }.count < 2
            if f.mode == .still {
                inst.glow[sweeping] = target
            } else if a < target {
                inst.glow[sweeping] = room ? min(target, a + min(G.alpha / G.riseMs * f.dt, slew)) : a
            } else {
                inst.glow[sweeping] = max(target, a - slew)
            }
        }

        // Emphasis (§5.5): graphemes lift and swell in sequence from 400 ms before the word, and
        // release 250 ms before its end. None while scrubbing; a seek lands on the state, no replay.
        let E = LyricsConfig.Emphasis.self
        for k in words.indices where k < boxes.count && k < inst.emph.count && !inst.emph[k].isEmpty {
            guard let e = boxes[k].emphasis else { continue }
            let w = words[k]
            for g in inst.emph[k].indices {
                let on = f.mode != .scrub && !reduced
                    && t >= w.start - E.anticipateMs + Double(g) * e.stepMs && t < w.end - E.releaseMs
                if settle {
                    inst.emph[k][g].snap(on ? 1 : 0)
                } else {
                    inst.emph[k][g].step(to: on ? 1 : 0, LyricSprings.lift, dtMs: f.dt)
                }
            }
        }
    }

    private func updateDots(_ fs: LyricFieldState, _ t: Double, _ dt: Double, still: Bool) {
        let IL = LyricsConfig.Interlude.self
        if fs.dots {
            let since = t - fs.from
            dots.opacity = lyricClamp(since / IL.enterMs, 0, 1)
            dotsLeave = dots.opacity
            for k in 0..<3 {
                let ph = (since - Double(k) * IL.dotStepMs) / IL.cycleMs
                let b = 0.5 - 0.5 * cos(2 * Double.pi * ph)
                dots.scale[k] = reduced ? 1 : 0.4 + 0.85 * b
                dots.alpha[k] = reduced ? LyricsConfig.Reduced.dotsAlpha : 0.2 + 0.7 * b
            }
        } else {
            dotsLeave = still ? 0 : max(0, dotsLeave - dt / IL.fadeMs)
            dots.opacity = dotsLeave
        }
    }

    // MARK: - Functions of time

    private static func table(_ points: [(Double, Double)], _ z: Double) -> Double {
        guard let first = points.first else { return 0 }
        if z <= first.0 { return first.1 }
        for k in 1..<points.count where z <= points[k].0 {
            let (z0, v0) = points[k - 1]
            let (z1, v1) = points[k]
            return v0 + (v1 - v0) * (z - z0) / (z1 - z0)
        }
        return points[points.count - 1].1
    }

    /// The distance functions (§4.1), of the drawn distance from the anchor.
    static func opacity(at z: Double) -> Double { table(LyricsConfig.opacity, z) }
    static func blur(at z: Double) -> Double { table(LyricsConfig.blur, z) }

    /// The unsung ink: 22% toward the room at the anchor so the sweep reads, fading in as a line
    /// arrives (z dz → 0); other lines are dimmed by opacity only.
    static func unlitMix(at z: Double) -> Double {
        LyricsConfig.unlitMix * lyricClamp(1 - z / LyricsConfig.Column.dz, 0, 1)
    }

    /// The word sweep (§5.1): linear in time, at least 60 ms long.
    static func sweep(_ w: LyricWord, _ t: Double) -> Double {
        lyricClamp((t - w.start) / max(w.end - w.start, LyricsConfig.Sweep.minWordMs), 0, 1)
    }

    /// The sweep as one soft edge along the whole line (§5.1; Spicy Lyrics' refreshed sweep): the
    /// words laid end to end, `widths` points each, the edge crossing each word in its own time. A
    /// word's value is how far the edge is through it, so it runs past 1 while the fade behind the
    /// edge still covers its end, and below 0 while the fade ahead already touches its start. Across
    /// a hold gap (> 300 ms) nothing ahead is lit, and the last word's fade clears over 250 ms.
    static func lineEdges(_ words: [LyricWord], _ widths: [Double], _ t: Double) -> [Double] {
        let W = words.indices.map { k in max(1, k < widths.count ? widths[k] : 1) }
        var X: [Double] = []
        var x = 0.0
        for w in W {
            X.append(x)
            x += w
        }
        var edge = 0.0
        var next = 0 // the first word not started
        while next < words.count, t >= words[next].start {
            edge = X[next] + W[next] * sweep(words[next], t)
            next += 1
        }
        // The fade ahead reaches words not yet started, up to the first hold gap.
        var reach = next - 1
        while reach >= 0, reach + 1 < words.count,
              words[reach + 1].start - words[reach].end <= LyricsConfig.Sweep.holdGapMs
        {
            reach += 1
        }
        let spill = reach >= next
        return words.indices.map { k -> Double in
            if k >= next { return k <= reach ? (edge - X[k]) / W[k] : unreached }
            let along = (edge - X[k]) / W[k]
            // Nothing after it yet: the fade behind the edge clears on its own.
            if k == next - 1, t > words[k].end, !spill {
                return max(along, 1 + (t - words[k].end) / settleMs * 4)
            }
            return along
        }
    }

    /// A lead word's own motion (§5.1), from time alone so a seek lands on it: it rises over
    /// max(1 s, its length); while sung it swells to 1.07 (in its first 140 ms, at most half of
    /// it), and eases back to 1 over 300 ms after its end. Held words swell per letter instead.
    static func wordMotion(_ w: LyricWord, _ t: Double, emphasised: Bool) -> (y: Double, s: Double) {
        let WM = LyricsConfig.Word.self
        let dur = w.end - w.start
        let u = lyricClamp((t - w.start) / max(1000, dur), 0, 1)
        let pop = max(1, min(WM.popMs, dur / 2))
        let up = lyricClamp((t - w.start) / pop, 0, 1)
        let down = lyricClamp((t - w.end) / WM.releaseMs, 0, 1)
        let peak = emphasised ? 1 : WM.peak
        let y = WM.liftEm * pow(1 - u, 3)
        let s = 1 + (peak - 1) * (1 - pow(1 - up, 3)) * (1 - down * down * (3 - 2 * down))
        return (y, s)
    }

    /// A line-synced line's wash (§9.2): 420 ms from its start, eased out.
    static func wash(_ line: LyricLine, _ t: Double) -> Double {
        let x = lyricClamp((t - line.start) / LyricsConfig.Wash.ms, 0, 1)
        return 1 - pow(1 - x, 4)
    }

    /// By new rank: past lines and rank 0 at 0 ms, +1 at 50, +2 at ≈ 98, +3 at ≈ 143… (§6.3).
    static func staggerMs(_ rank: Int) -> Double {
        let S = LyricsConfig.Stagger.self
        return rank <= 0 ? 0 : S.baseMs * (1 - pow(S.decay, -Double(rank))) / (1 - 1 / S.decay)
    }
}
