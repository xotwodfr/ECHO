import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// Listen together's screens (docs/TOGETHER.md; Together/Together.swift): Now Playing's Together
// button, the sheet (the Mac's too) that joins a session or shows the one this person is in (the
// listeners, the shared queue, Leave), the offer a scanned code or link makes (whose session, Join
// or Not now), and the shared queue in Now Playing's Up next. All of it is always dark, like Now
// Playing it comes from, and reads the theme for its colours.

/// A person in the session: their initial on a disc, dimmed while away.
struct TogetherAvatar: View {
    let name: String
    var online = true
    var size: CGFloat = 34
    @Environment(\.theme) private var theme

    var body: some View {
        Text(name.prefix(1).uppercased())
            .font(.system(size: size * 0.44, weight: .heavy))
            .foregroundStyle(theme.onAccent)
            .frame(width: size, height: size)
            .background(theme.accent.opacity(online ? 1 : 0.4), in: .circle)
            .accessibilityHidden(true)
    }
}

/// Now Playing's Together button: a person pair, lit while in a session.
struct TogetherButton: View {
    @Environment(Together.self) private var together

    var body: some View {
        Button(together.label, systemImage: "person.2.fill") { together.sheetOpen = true }
            .labelStyle(.iconOnly)
            .glassToggle(together.session != nil)
            .accessibilityLabel(together.session == nil ? "Listen together" : together.label)
    }
}

// MARK: - The sheet

/// Listen together: not in a session, how to join (scan a code, paste a link); in one, who is
/// listening, the song and the queue, and Leave (End session for the host).
struct TogetherPanel: View {
    let close: () -> Void

    @Environment(\.theme) private var theme
    @Environment(Together.self) private var together
    @Environment(Session.self) private var session
    @State private var link = ""
    @State private var linkNote: String? = nil
    /// The invite and the listeners open over the panel once it has settled (a cover cannot open
    /// while a sheet is still coming up).
    @State private var settled = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if let state = together.session {
                    sessionBody(state)
                } else {
                    idle
                }
            }
            .frame(maxWidth: 520, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 30)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .animation(.smooth, value: together.session)
        .animation(.smooth, value: together.note)
        .task {
            try? await Task.sleep(for: .milliseconds(700))
            settled = true
        }
        .modifier(TogetherOverPanel(settled: settled))
    }

    private var header: some View {
        HStack {
            Text(together.session == nil ? "Listen together" : "Listening together")
                .font(.title2.bold())
            if let state = together.session {
                Text("· \(state.listeners)").font(.title2).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Close", systemImage: "xmark", action: close)
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(.large)
        }
    }

    // MARK: Not in a session

    private var idle: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Everyone hears the same song at the same moment, and everyone can add songs. Scan the host's QR code or paste their link to join.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            #if os(iOS)
            Button {
                together.sheetOpen = false
                // The scanner opens once this sheet is gone: a cover cannot open over a sheet closing.
                Task {
                    try? await Task.sleep(for: .milliseconds(450))
                    together.scanning = true
                }
            } label: {
                Label("Scan a code to join", systemImage: "qrcode.viewfinder")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .tint(theme.accent)
            .foregroundStyle(theme.onAccent)
            .controlSize(.large)
            #endif
            Button {
                Task { await together.start() }
            } label: {
                Label(together.starting ? "Starting…" : "Start a session", systemImage: "person.2.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            .disabled(together.starting)
            Text("A session starts on the song playing, with what is up next. Then show its QR code to whoever should join.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            pasteLink
            if let note = together.note {
                Text(note)
                    .font(.subheadline)
                    .foregroundStyle(theme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// A link from a message or a browser: `<server>/together/<id>`.
    private var pasteLink: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Or paste a link").font(.subheadline.weight(.semibold))
            HStack(spacing: 10) {
                TextField("\(session.server)/together/…", text: $link)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .themedGlass(16)
                    .submitLabel(.join)
                    .onSubmit(joinLink)
                Button("Join", action: joinLink)
                    .buttonStyle(.glass)
                    .controlSize(.large)
                    .disabled(link.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let linkNote {
                Text(linkNote).font(.footnote).foregroundStyle(theme.warning)
            }
        }
    }

    private func joinLink() {
        let text = link
        guard let id = TogetherLink.id(in: text, server: session.client.base) else {
            linkNote = "That isn't a Listen together link for \(session.server)."
            return
        }
        linkNote = nil
        link = ""
        Task { await together.consider(id) }
    }

    // MARK: In a session

    @ViewBuilder
    private func sessionBody(_ state: TogetherState) -> some View {
        if !together.connected {
            Label("Reconnecting…", systemImage: "arrow.triangle.2.circlepath")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        if let now = state.now {
            VStack(alignment: .leading, spacing: 8) {
                sectionTitle("Now playing")
                TogetherRow(item: now, state: state, isNow: true)
            }
        } else {
            Text("Nothing playing yet: add a song from any song's menu.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        if !state.you.host {
            Label("Only the host controls playback. You can add songs from any song's menu.", systemImage: "hand.raised.fill")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        HStack(spacing: 10) {
            Button("Invite", systemImage: "qrcode") { together.inviteOpen = true }
                .frame(maxWidth: .infinity)
            Button("Listeners", systemImage: "person.2") { together.membersOpen = true }
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Listeners")
            ForEach(state.members) { member in
                HStack(spacing: 12) {
                    TogetherAvatar(name: member.username, online: member.online)
                    Text(member.username).font(.body)
                    Spacer(minLength: 8)
                    Text(tags(member, state)).font(.footnote).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Up next")
            if state.queue.isEmpty {
                Text("Nothing queued. Add songs from any song's menu.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ForEach(state.queue) { item in
                TogetherRow(item: item, state: state, isNow: false)
            }
        }
        Button(state.you.host ? "End session" : "Leave", systemImage: "rectangle.portrait.and.arrow.right") {
            Task { await together.leave() }
        }
        .buttonStyle(.glass)
        .controlSize(.large)
        .frame(maxWidth: .infinity)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
    }

    /// "host · you", "away".
    private func tags(_ member: TogetherMember, _ state: TogetherState) -> String {
        [member.host ? "host" : nil, member.id == state.you.id ? "you" : nil, member.online ? nil : "away"]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

/// A song of the shared queue: its cover, title, and who added it; the host plays it now or removes
/// any, a member removes their own.
struct TogetherRow: View {
    let item: TogetherItem
    let state: TogetherState
    let isNow: Bool

    @Environment(Together.self) private var together

    var body: some View {
        let mine = item.addedBy.id == state.you.id
        HStack(spacing: 12) {
            Cover(path: item.track.cover, corner: 6).frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.track.title)
                    .font(.body.weight(isNow ? .bold : .medium))
                    .lineLimit(1)
                Text("\(item.track.artist) · added by \(mine ? "you" : item.addedBy.username)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if !isNow, state.mayRemove(item) || state.you.host {
                Menu {
                    if state.you.host {
                        Button("Play Now", systemImage: "play.fill") { together.jump(item) }
                    }
                    if state.mayRemove(item) {
                        Button("Remove", systemImage: "minus.circle", role: .destructive) {
                            Task { await together.remove(item) }
                        }
                    }
                } label: {
                    Label("More", systemImage: "ellipsis").labelStyle(.iconOnly).frame(width: 34, height: 34)
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - The offer

/// A scanned code or an opened link: whose session it is, then Join or Not now.
struct TogetherOfferSheet: View {
    let offer: TogetherOffer

    @Environment(\.theme) private var theme
    @Environment(Together.self) private var together

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "person.2.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(theme.highlight)
                Text("Listen together").font(.title2.bold())
            }
            Group {
                if case .loading = offer {
                    HStack(spacing: 10) {
                        ProgressView().tint(.white)
                        Text(offer.text)
                    }
                } else {
                    Text(offer.text)
                }
            }
            .font(.subheadline)
            .foregroundStyle(.white.opacity(0.8))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.updatesFrequently)
            Spacer(minLength: 6)
            if case .ready(let id, _, _) = offer {
                Button {
                    Task { await together.join(id) }
                } label: {
                    Text(together.joining ? "Joining…" : "Join").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .tint(theme.accent)
                .foregroundStyle(theme.onAccent)
                .controlSize(.large)
                .disabled(together.joining)
            }
            Button {
                together.dismissOffer()
            } label: {
                Text("Not now").font(.headline).frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            .controlSize(.large)
        }
        .padding(.horizontal, 22)
        .padding(.top, 26)
        .padding(.bottom, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - The queue in Now Playing

/// Up next in a session: the shared queue, who added each song; the host plays one now from its menu,
/// anyone swipes to remove their own (the host's: any).
struct SharedQueueList: View {
    @Environment(Together.self) private var together

    var body: some View {
        List {
            if let state = together.session {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Up next").font(.title3.bold())
                        Text(state.you.host ? "You control playback" : "\(state.host.username) controls playback")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    HStack(spacing: -8) {
                        ForEach(Array(state.members.prefix(5))) { member in
                            TogetherAvatar(name: member.username, online: member.online, size: 30)
                                .overlay(Circle().stroke(.black.opacity(0.35), lineWidth: 2))
                        }
                    }
                    .accessibilityElement()
                    .accessibilityLabel("\(state.listeners) listening")
                }
                .queueRow()
                if state.queue.isEmpty {
                    Text("Nothing queued. Add songs from any song's menu.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .queueRow()
                }
                ForEach(state.queue) { item in
                    TogetherRow(item: item, state: state, isNow: false)
                    .swipeActions(edge: .trailing) {
                        if state.mayRemove(item) {
                            Button("Remove", role: .destructive) { Task { await together.remove(item) } }
                        }
                    }
                    .queueRow()
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .contentMargins(.vertical, 14, for: .scrollContent)
        .mask {
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0), .init(color: .black, location: 0.035),
                    .init(color: .black, location: 0.93), .init(color: .clear, location: 1),
                ],
                startPoint: .top, endPoint: .bottom)
        }
        .animation(.smooth, value: together.session)
    }
}

// MARK: - Presenting them

/// The sheets Listen together opens, from Now Playing while it is open and from the shell otherwise
/// (a sheet cannot open under a full-screen cover): the offer, the Together sheet (Now Playing's
/// button; on the Mac the window's), and on the iPhone the camera for a code.
struct TogetherSheets: ViewModifier {
    enum Place { case nowPlaying, shell }
    let place: Place

    @Environment(Together.self) private var together
    @Environment(Session.self) private var session
    @Environment(Library.self) private var library
    @Environment(Player.self) private var player

    /// This place is the one to show them: Now Playing's while it is open, else the shell's (the
    /// Mac has no Now Playing page, so its window's).
    private var here: Bool {
        #if os(macOS)
        place == .shell
        #else
        (place == .nowPlaying) == together.nowPlayingShown
        #endif
    }

    func body(content: Content) -> some View {
        #if os(macOS)
        // The Mac's are cards in the window itself (a sheet or popover is a window of its own).
        content
            .overlay {
                if here, let offer = together.offer {
                    ZStack {
                        Color.black.opacity(0.35).ignoresSafeArea().onTapGesture { together.dismissOffer() }
                        TogetherOfferSheet(offer: offer)
                            .frame(width: 380, height: 270)
                            .background { AlbumLight(strength: 0.85) }
                            .themedDark()
                            .clipShape(.rect(cornerRadius: 28))
                            .shadow(color: .black.opacity(0.4), radius: 30, y: 12)
                    }
                    .transition(.opacity)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if here, together.sheetOpen {
                    TogetherPanel { together.sheetOpen = false }
                        .padding(.top, 14)
                        .frame(width: 420, height: 580)
                        .background { AlbumLight(strength: 0.85) }
                        .themedDark()
                        .clipShape(.rect(cornerRadius: 28))
                        .shadow(color: .black.opacity(0.4), radius: 30, y: 12)
                        .padding(.trailing, 20)
                        .padding(.bottom, 110)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .animation(.smooth, value: together.sheetOpen)
            .animation(.smooth, value: together.offer)
        #else
        content
            .sheet(isPresented: Binding(get: { here && together.offer != nil }, set: { if !$0 { together.dismissOffer() } })) {
                if let offer = together.offer {
                    TogetherOfferSheet(offer: offer)
                        .background { AlbumLight(strength: 0.85).ignoresSafeArea() }
                        .themedDark()
                        .presentationDetents([.height(offer.isReady ? 300 : 260)])
                        .presentationDragIndicator(.visible)
                        .presentationBackground { AlbumLight(strength: 0.85) }
                        .environment(together)
                        .environment(library)
                }
            }
            .sheet(isPresented: Binding(get: { here && together.sheetOpen }, set: { together.sheetOpen = $0 })) {
                TogetherPanel { together.sheetOpen = false }
                    .padding(.top, 14)
                    .background { AlbumLight(strength: 0.85).ignoresSafeArea() }
                    .themedDark()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                    .presentationBackground { AlbumLight(strength: 0.85) }
                    .environment(together)
                    .environment(session)
                    .environment(library)
                    .environment(player)
            }
            .fullScreenCover(isPresented: Binding(get: { here && together.scanning }, set: { together.scanning = $0 })) {
                ScanScreen(flow: ScanFlow(purpose: .joinTogether, session: session, together: together)) {
                    together.scanning = false
                }
                .environment(session)
            }
        #endif
    }
}

extension TogetherOffer {
    var isReady: Bool {
        if case .ready = self { return true }
        return false
    }
}

// MARK: - The invite and the listeners

/// The invite and the listener list, over the Together sheet: full-screen on the iPhone, a card in the
/// panel on the Mac.
struct TogetherOverPanel: ViewModifier {
    let settled: Bool

    @Environment(Together.self) private var together

    func body(content: Content) -> some View {
        #if os(iOS)
        content
            .fullScreenCover(isPresented: Binding(get: { settled && together.inviteOpen }, set: { together.inviteOpen = $0 })) {
                TogetherInvite { together.inviteOpen = false }
                    .environment(together)
            }
            .sheet(isPresented: Binding(get: { settled && together.membersOpen }, set: { together.membersOpen = $0 })) {
                TogetherMembers { together.membersOpen = false }
                    .background { AlbumLight(strength: 0.85).ignoresSafeArea() }
                    .themedDark()
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
                    .presentationBackground { AlbumLight(strength: 0.85) }
                    .environment(together)
            }
        #else
        content
            .overlay {
                if together.inviteOpen {
                    TogetherInvite { together.inviteOpen = false }
                        .background { AlbumLight(strength: 0.85) }
                        .transition(.opacity)
                } else if together.membersOpen {
                    TogetherMembers { together.membersOpen = false }
                        .background { AlbumLight(strength: 0.85) }
                        .transition(.opacity)
                }
            }
            .animation(.smooth, value: together.inviteOpen)
            .animation(.smooth, value: together.membersOpen)
        #endif
    }
}

/// The session's QR code as a big plate on glass (the guest invite's look), its link to share or
/// copy, and who is listening.
struct TogetherInvite: View {
    let close: () -> Void

    @Environment(\.theme) private var theme
    @Environment(Together.self) private var together
    @State private var copied = false

    var body: some View {
        ZStack(alignment: .top) {
            AlbumLight(strength: 0.85).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 22) {
                    HStack {
                        Button("Close", systemImage: "xmark", action: close)
                            .labelStyle(.iconOnly)
                            .buttonStyle(.glass)
                            .buttonBorderShape(.circle)
                            .controlSize(.large)
                            .tint(.white)
                        Spacer()
                        Text("Invite to listen").font(.headline)
                        Spacer()
                        Color.clear.frame(width: 44, height: 44)
                    }
                    plate
                    if let state = together.session {
                        Label(
                            state.listeners == 1 ? "Only you so far" : "\(state.listeners) listening",
                            systemImage: "person.2.fill"
                        )
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.85))
                    }
                    Text("They scan this with ECHO (Now Playing → Together → Scan a code to join), or open the link while signed in to this ECHO. Their music then follows yours.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12)
                    if let link = together.inviteLink {
                        actions(link)
                    }
                }
                .frame(maxWidth: 420)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 30)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .themedDark()
        .animation(.smooth, value: together.session?.listeners)
    }

    private var plate: some View {
        VStack(spacing: 16) {
            if let link = together.inviteLink {
                QRCodeView(text: link.absoluteString, label: "Listen together QR code")
                    .frame(maxWidth: 300)
                Text(link.absoluteString)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.7))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
            } else {
                ProgressView().controlSize(.large).tint(.white)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 340)
        .padding(22)
        .glassEffect(.regular, in: .rect(cornerRadius: 34))
    }

    private func actions(_ link: URL) -> some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                ShareLink(item: link) {
                    Label("Share link", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                }
                Button {
                    copy(link.absoluteString)
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.glass)
            .controlSize(.large)
        }
    }

    private func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

/// Who is in the session: the host, you, anyone away; and what each may do. The server has no way to
/// remove a listener, so the host's choices are ending the session and who controls (the host alone).
struct TogetherMembers: View {
    let close: () -> Void

    @Environment(Together.self) private var together

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Listeners").font(.title2.bold())
                    if let state = together.session {
                        Text("· \(state.listeners)").font(.title2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Close", systemImage: "xmark", action: close)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .controlSize(.large)
                }
                if let state = together.session {
                    ForEach(state.members) { member in
                        HStack(spacing: 12) {
                            TogetherAvatar(name: member.username, online: member.online, size: 40)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(member.username).font(.body.weight(.medium))
                                Text(role(member, state)).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            if member.host {
                                Image(systemName: "crown.fill").foregroundStyle(.secondary).accessibilityHidden(true)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                    Text("The host controls playback; everyone can add songs. Listeners who stop streaming for 30 minutes are dropped.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(state.you.host ? "End session for everyone" : "Leave the session", systemImage: "rectangle.portrait.and.arrow.right") {
                        Task { await together.leave() }
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: 520, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 30)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private func role(_ member: TogetherMember, _ state: TogetherState) -> String {
        let you = member.id == state.you.id ? " · you" : ""
        let status = member.online ? "" : " · away"
        return (member.host ? "Host" : "Listener") + you + status
    }
}
