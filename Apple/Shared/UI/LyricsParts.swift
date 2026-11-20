import SwiftUI

// What the iPhone's lyrics screen and the Mac's lyrics view share (LYRICS_EXPERIENCE.md §9.3–§9.5,
// §10, §11; the web's StageViews.tsx): the lyrics as they stand (waiting for them, the field, the
// unsynced sheet, the still sheet with Motion off, none found, ECHO not answering), the source's
// credit and its menu (the source, "use this source for this track", the timing), and the song's
// clock as the lyrics read it.

/// The lyrics in their area: the stage starts `top` points down and ends `bottom` points above the
/// area's end (the anchor at 40% of it), the column running under the glass past both.
struct LyricsStage: View {
    var top: CGFloat
    var bottom: CGFloat
    let style: LyricStyle

    @Environment(Player.self) private var player
    @Environment(Lyrics.self) private var lyrics
    @Environment(\.accessibilityReduceMotion) private var systemReduced
    @Environment(DeviceSettings.self) private var device: DeviceSettings?
    @State private var running = true

    var body: some View {
        ZStack {
            switch lyrics.phase {
            case .idle:
                Color.clear
            case .waiting(let since):
                LyricsWaiting(since: since, top: top, bottom: bottom)
                    .transition(.opacity)
            case .ready(let doc):
                ready(doc)
                    .transition(.opacity)
            case .missing(let tried):
                note {
                    if lyrics.isInstrumental {
                        NoteCard(icon: "music.note", title: "Instrumental", text: "No words in this one.")
                    } else {
                        NoteCard(icon: "quote.bubble", title: "No lyrics found", text: "Sources tried: \(Lyrics.triedText(tried))")
                    }
                }
                .transition(.opacity)
            case .failed(let error):
                note {
                    ErrorCard(title: "Couldn't load the lyrics", error: error) { lyrics.reload() }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.42), value: lyrics.phaseKey)
    }

    @ViewBuilder
    private func ready(_ doc: LyricsDoc) -> some View {
        let motion = lyrics.preferences.visuals.effectiveMotion(performance: device?.performance ?? false)
        if doc.sync == .plain {
            if lyrics.preferences.lyrics.showUnsynced {
                LyricSheet(doc: doc, style: style, top: top, bottom: bottom)
            } else {
                note {
                    NoteCard(
                        icon: "text.alignleft", title: "Lyrics aren't time-synced",
                        text: "Show unsynced lyrics is off in Settings → Lyrics.")
                }
            }
        } else if motion == .off {
            // Motion off (§10, WCAG 2.2.2): a still sheet, the line being sung marked, nothing moving.
            LyricStillSheet(doc: doc, style: style, top: top, bottom: bottom)
        } else {
            LyricFieldView(
                doc: doc, style: style, top: top, bottom: bottom,
                reduced: motion == .reduced || (motion == .system && systemReduced), running: running,
                announce: lyrics.preferences.lyrics.announceLines,
                clock: { LyricClock(player: player, lyrics: lyrics) },
                onLine: { line in playFrom(line) }
            )
            .id(doc.id)
            // Paused and settled, the field stops drawing; a seek, the scrubber or playing wakes it.
            .task(id: wake) {
                running = true
                guard !player.isPlaying, player.scrubbing == nil else { return }
                try? await Task.sleep(for: .seconds(2))
                if !Task.isCancelled { running = false }
            }
        }
    }

    private var wake: String {
        "\(player.isPlaying)|\(player.position)|\(player.scrubbing ?? -1)|\(lyrics.totalOffsetMs)|\(lyrics.doc?.id ?? "")"
    }

    /// Spotify's: a tap on a line plays from it (the user's offset added back).
    private func playFrom(_ line: LyricLine) {
        player.seek(to: max(0, (line.start + Double(lyrics.totalOffsetMs)) / 1000))
        if !player.isPlaying { player.resume() }
    }

    private func note<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let card = content()
        return GeometryReader { geo in
            card
                .frame(maxWidth: 420)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
                .position(x: geo.size.width / 2, y: top + (geo.size.height - top - bottom) * 0.42)
        }
    }
}

extension LyricClock {
    /// The lyrics' clock: what is heard (the output's latency off), or the scrubber while it is
    /// held, less the user's offsets (§9.13); the lyrics only, never the song.
    @MainActor
    init(player: Player, lyrics: Lyrics) {
        let offset = Double(lyrics.totalOffsetMs)
        if let held = player.scrubbing {
            self.init(ms: held * 1000 - offset, playing: false, scrubbing: true)
        } else {
            self.init(ms: player.audibleTime * 1000 - offset, playing: player.status == .playing, scrubbing: false)
        }
    }
}

/// Waiting for the lyrics (§9.5): nothing for 600 ms (most come from the cache at once), then the
/// interlude dots at the anchor, with "Finding lyrics…" from 1.5 s.
struct LyricsWaiting: View {
    let since: Date
    var top: CGFloat
    var bottom: CGFloat

    var body: some View {
        GeometryReader { geo in
            TimelineView(.periodic(from: since, by: 0.25)) { context in
                let waited = context.date.timeIntervalSince(since)
                VStack(spacing: 12) {
                    HStack(spacing: 10) {
                        ForEach(0..<3, id: \.self) { _ in
                            Circle().fill(.white.opacity(0.6)).frame(width: 9, height: 9)
                        }
                    }
                    Text("Finding lyrics…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .opacity(waited >= 1.5 ? 1 : 0)
                }
                .opacity(waited >= 0.6 ? 1 : 0)
                .animation(.easeOut(duration: 0.25), value: waited >= 0.6)
                .position(x: geo.size.width / 2, y: top + (geo.size.height - top - bottom) * CGFloat(LyricsConfig.anchorY))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Finding lyrics")
    }
}

/// Unsynced lyrics (§9.3): a still sheet in the column, at 0.62 of the active size and rank +1's
/// ink, scrolled by the reader; a note under the first line says they are not time-synced.
struct LyricSheet: View {
    let doc: LyricsDoc
    let style: LyricStyle
    var top: CGFloat
    var bottom: CGFloat

    var body: some View {
        GeometryReader { geo in
            let lines = doc.lines.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            let size = style.face.size * 0.62
            ScrollView {
                VStack(alignment: .leading, spacing: size * 0.6) {
                    ForEach(lines.indices, id: \.self) { i in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(lines[i].text)
                                .font(LyricFonts.font(style, size))
                                .kerning(style.face.tracking * size)
                                .foregroundStyle(Color(style.ink).opacity(0.74))
                            if i == 0 {
                                Text("Lyrics aren’t time-synced for this track · \(doc.attribution.text)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, CGFloat((1 - LyricsConfig.maxWidth) / 2) * geo.size.width)
                // The first line a little above the anchor: the sheet is read, not followed.
                .padding(.top, top + (geo.size.height - top - bottom) * 0.2)
                .padding(.bottom, bottom + geo.size.height * 0.3)
            }
            .scrollIndicators(.hidden)
            .mask(LyricEdges(top: top, bottom: bottom, height: geo.size.height))
        }
    }
}

/// Motion off (§10): every line still, the one being sung in the lit colour, the sheet jumping to
/// it at each hand-over without moving; a tap on a line plays from it.
struct LyricStillSheet: View {
    let doc: LyricsDoc
    let style: LyricStyle
    var top: CGFloat
    var bottom: CGFloat

    @Environment(Player.self) private var player
    @Environment(Lyrics.self) private var lyrics

    var body: some View {
        GeometryReader { geo in
            let lines = doc.lines.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            let size = style.face.size * 0.62
            TimelineView(.periodic(from: .now, by: 0.25)) { _ in
                let t = LyricClock(player: player, lyrics: lyrics).ms
                let active = lines.lastIndex { $0.start <= t } ?? -1
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: size * 0.6) {
                            ForEach(lines.indices, id: \.self) { i in
                                Button {
                                    player.seek(to: max(0, (lines[i].start + Double(lyrics.totalOffsetMs)) / 1000))
                                    if !player.isPlaying { player.resume() }
                                } label: {
                                    Text(lines[i].text)
                                        .font(LyricFonts.font(style, size))
                                        .kerning(style.face.tracking * size)
                                        .foregroundStyle(i == active ? Color(style.lit) : Color(style.ink).opacity(0.74))
                                        .multilineTextAlignment(.leading)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain)
                                .id(i)
                                .accessibilityAddTraits(i == active ? .isSelected : [])
                            }
                        }
                        .padding(.horizontal, CGFloat((1 - LyricsConfig.maxWidth) / 2) * geo.size.width)
                        .padding(.top, top + 20)
                        .padding(.bottom, bottom + geo.size.height * 0.4)
                    }
                    .scrollIndicators(.hidden)
                    .onChange(of: active, initial: true) {
                        if active >= 0 { proxy.scrollTo(active, anchor: UnitPoint(x: 0, y: 0.4)) }
                    }
                }
            }
            .mask(LyricEdges(top: top, bottom: bottom, height: geo.size.height))
        }
    }
}

/// The lyrics fade in under the top's glass and out over the bottom's: no hard edge.
struct LyricEdges: View {
    var top: CGFloat
    var bottom: CGFloat
    var height: CGFloat

    var body: some View {
        let h = max(1, height)
        let a = min(0.45, max(0.01, (top - 24) / h))
        let b = min(0.5, max(a + 0.01, (top + 24) / h))
        let c = max(b + 0.01, min(0.97, (h - bottom - 16) / h))
        let d = max(c + 0.01, min(1, (h - bottom * 0.4) / h))
        LinearGradient(
            stops: [
                .init(color: .clear, location: a), .init(color: .black, location: b), .init(color: .black, location: c),
                .init(color: .clear, location: d),
            ],
            startPoint: .top, endPoint: .bottom)
    }
}

/// The source's credit (LYRICS_INTEGRATION.md §8, the approved preview's "Word-synced · LRCLIB")
/// on glass; a tap opens the lyrics menu.
struct LyricsCredit: View {
    @Binding var menu: Bool

    @Environment(Lyrics.self) private var lyrics

    var body: some View {
        if let doc = lyrics.doc {
            Button {
                menu = true
            } label: {
                Label("\(Self.syncName(doc.sync)) · \(Lyrics.sourceName(doc.source))", systemImage: "info.circle")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
            .accessibilityLabel("Lyrics source: \(Lyrics.sourceName(doc.source)), \(Self.syncName(doc.sync))")
            .accessibilityHint("Shows the source and the timing")
            .popover(isPresented: $menu, arrowEdge: .top) {
                LyricsMenu { menu = false }
                    .presentationCompactAdaptation(.popover)
            }
        }
    }

    static func syncName(_ sync: LyricSync) -> String {
        switch sync {
        case .word: "Word-synced"
        case .line: "Line-synced"
        case .plain: "Not synced"
        }
    }
}

/// The lyrics menu (the web's ⓘ, and its `[` / `]` keys): where they come from, the source to use
/// for this track, and the timing for this track.
struct LyricsMenu: View {
    let close: () -> Void

    @Environment(Lyrics.self) private var lyrics

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let doc = lyrics.doc {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Lyrics").font(.headline)
                    Text(Self.attributed(doc.attribution))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .tint(Color.echoTint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 2) {
                heading("Source for this song")
                row("Automatic", on: lyrics.pinnedSource == nil) { pin(nil) }
                ForEach(Lyrics.sourceNames.indices, id: \.self) { i in
                    let source = Lyrics.sourceNames[i]
                    row(source.name, on: lyrics.pinnedSource == source.id) { pin(source.id) }
                        .accessibilityLabel("Use \(source.name) for this song")
                }
            }
            if lyrics.doc?.sync != .plain {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    heading("Timing for this song")
                    HStack(spacing: 12) {
                        step("minus", "Earlier") { lyrics.nudge(-1) }
                            .accessibilityHint("Shows this song's lyrics 50 ms earlier")
                        Text(Lyrics.offsetMessage(lyrics.totalOffsetMs))
                            .font(.subheadline.weight(.medium))
                            .monospacedDigit()
                            .frame(maxWidth: .infinity)
                        step("plus", "Later") { lyrics.nudge(1) }
                            .accessibilityHint("Shows this song's lyrics 50 ms later")
                    }
                    if lyrics.offsetMs != 0 {
                        Button("Back to the song's own timing") { lyrics.resetOffset() }
                            .font(.footnote)
                            .foregroundStyle(Color.echoTint)
                            .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(18)
        .frame(width: 310)
    }

    private func heading(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
    }

    /// A timing step: white on glass, as the approved look's controls are.
    private func step(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityLabel(label)
    }

    private func row(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title).font(.subheadline)
                Spacer(minLength: 8)
                if on {
                    Image(systemName: "checkmark").font(.subheadline.weight(.semibold)).foregroundStyle(Color.echoTint)
                }
            }
            .padding(.vertical, 6)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func pin(_ source: String?) {
        close()
        Task { await lyrics.pin(source) }
    }

    /// The attribution, its named parts linked (web links only); it cannot be hidden.
    static func attributed(_ a: LyricsAttribution) -> AttributedString {
        var text = AttributedString(a.text)
        for link in a.links {
            guard let url = URL(string: link.href), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  let range = text.range(of: link.label)
            else { continue }
            text[range].link = url
        }
        return text
    }
}

#if os(iOS)
/// The song under the lyrics on the iPhone (the approved preview's): its cover, title and artist,
/// previous, play or pause and next, and the scrubber, in one glass card.
struct LyricsPlayerCard: View {
    @Environment(Player.self) private var player

    var body: some View {
        if let track = player.track {
            VStack(spacing: 8) {
                HStack(spacing: 10) {
                    Cover(path: track.cover, corner: 10).frame(width: 46, height: 46)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(track.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text(track.artist).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                    Spacer(minLength: 6)
                    control("backward.fill", "Previous", size: 20) { player.previous() }
                    control(player.isPlaying ? "pause.fill" : "play.fill", player.isPlaying ? "Pause" : "Play", size: 28) {
                        player.toggle()
                    }
                    control("forward.fill", "Next", size: 20) { player.next() }
                        .disabled(!player.hasNext)
                        .opacity(player.hasNext ? 1 : 0.4)
                }
                Scrubber(layout: .bare)
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 6)
            .glassEffect(.regular, in: .rect(cornerRadius: 30))
        }
    }

    private func control(_ icon: String, _ label: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(.white)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
#endif
