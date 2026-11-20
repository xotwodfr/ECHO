import SwiftUI

/// Settings → Guests (the web's GuestsBlock): invite a guest with a QR code, and the guests this
/// user invited (every guest, for an admin), each with the time left, Approve for a request to
/// stay, and End now. In the room, white on glass, as Settings.
struct GuestsScreen: View {
    @Environment(GuestInvites.self) private var invites
    @State private var inviting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Show a QR code: whoever scans it with ECHO on their iPhone or Android phone can listen to your library for an hour, a day or a week. Guests listen only, and their account goes when the time is up.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    inviting = true
                } label: {
                    Label("Invite a guest", systemImage: "qrcode")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        #if os(macOS)
                        .frame(minHeight: 30)
                        #endif
                }
                .buttonStyle(.glassProminent)
                .tint(Color.echoAccent)
                .controlSize(.large)
                list
                if let note = invites.note {
                    Text(note).font(.subheadline).foregroundStyle(Color.echoWarning)
                }
            }
            .padding(.horizontal, pagePadding)
            .padding(.top, 8)
            .padding(.bottom, 40)
        }
        .echoRoom(strength: 0.5, height: 520)
        .navigationTitle("Guests")
        .clearBars()
        .task { await invites.load() }
        .refreshable { await invites.load() }
        #if os(iOS)
        .fullScreenCover(isPresented: $inviting) {
            InviteSheet { inviting = false }
                .environment(invites)
        }
        #else
        .sheet(isPresented: $inviting) {
            InviteSheet { inviting = false }
                .environment(invites)
                .frame(width: 440, height: 640)
        }
        #endif
    }

    @ViewBuilder private var list: some View {
        if invites.guests.isEmpty {
            if let error = invites.state.error {
                ErrorCard(title: "Couldn't load your guests", error: error) { Task { await invites.load() } }
            } else if invites.state == .ready {
                NoteCard(icon: "person.2", title: "No guests right now", text: "Guests you invite are listed here until their time is up.")
            } else {
                LoadingView()
            }
        } else {
            SettingsGroup(title: "Listening now") {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    VStack(spacing: 0) {
                        ForEach(Array(invites.guests.enumerated()), id: \.element.id) { index, guest in
                            if index > 0 { SettingsDivider() }
                            GuestRow(guest: guest, now: context.date)
                        }
                    }
                }
            }
        }
    }
}

/// A guest: who, the time left, and what the inviter can do.
private struct GuestRow: View {
    let guest: Guest
    let now: Date

    @Environment(GuestInvites.self) private var invites
    @State private var busy = false

    var body: some View {
        HStack(spacing: 12) {
            Text(String((guest.keep?.username ?? guest.username).prefix(1)).uppercased())
                .font(.headline)
                .frame(width: 40, height: 40)
                .background(Color.echoAccent.opacity(0.55), in: .circle)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(guest.keep.map { "\($0.username) (wants to stay)" } ?? guest.username)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                Text("Guest · \(PassText.left(until: guest.ends, now: now))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if guest.keep != nil {
                Button("Approve") { act { await invites.keep(guest) } }
                    .buttonStyle(.glassProminent)
                    .tint(Color.echoAccent)
                    .disabled(busy)
            }
            Button("End now") { act { await invites.end(guest) } }
                .buttonStyle(.glass)
                .foregroundStyle(Color.echoWarning)
                .disabled(busy)
        }
        .padding(.vertical, 6)
    }

    private func act(_ run: @escaping () async -> Void) {
        busy = true
        Task {
            await run()
            busy = false
        }
    }
}

/// Invite a guest: the code as a big QR code on glass, to be scanned within 10 minutes, the time it
/// gives (an hour, a day, a week), and the guest joining. Full screen on the iPhone; a sheet on the
/// Mac.
struct InviteSheet: View {
    let close: () -> Void

    @Environment(GuestInvites.self) private var invites

    var body: some View {
        ZStack(alignment: .top) {
            AlbumLight(strength: 0.85).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 22) {
                    header
                    plate
                    lengths
                    Text("They open ECHO on their phone, tap Scan a guest pass on the sign-in page and point it here.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12)
                }
                .frame(maxWidth: 420)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 30)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
        .animation(.smooth, value: invites.code)
        .animation(.smooth, value: invites.joined)
        .task { if invites.code == nil { await invites.invite(invites.length) } }
        .task(id: invites.code) { await invites.watchForJoin() }
    }

    private var header: some View {
        HStack {
            Button("Close", systemImage: "xmark") {
                close()
                Task { await invites.closeInvite() }
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .controlSize(.large)
            .tint(.white)
            Spacer()
            Text("Invite a guest").font(.headline)
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
    }

    /// The QR code on its glass, or what stands in its place.
    private var plate: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let left = invites.code.map { Int($0.expires.timeIntervalSince(context.date).rounded(.up)) } ?? 0
            VStack(spacing: 16) {
                if let joined = invites.joined {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 64, weight: .semibold))
                        .foregroundStyle(Color.amber)
                    Text("\(joined) joined").font(.title2.bold())
                    Text("They're in. They can listen for \(invites.length.label).")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.75))
                    Button("Done", action: close).buttonStyle(.glassProminent).tint(Color.echoAccent).controlSize(.large)
                } else if let code = invites.code, left > 0 {
                    QRCodeView(text: code.url)
                        .frame(maxWidth: 300)
                    Label("Works once, for \(PassText.clock(left))", systemImage: "timer")
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.white.opacity(0.85))
                } else if invites.code != nil {
                    Text("This code ran out.").font(.headline)
                    Button("New code", systemImage: "arrow.clockwise") { Task { await invites.invite(invites.length) } }
                        .buttonStyle(.glass)
                } else if let error = invites.inviteError {
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(Color.echoWarning)
                        .multilineTextAlignment(.center)
                    Button("Try Again", systemImage: "arrow.clockwise") { Task { await invites.invite(invites.length) } }
                        .buttonStyle(.glass)
                } else {
                    ProgressView().controlSize(.large).tint(.white)
                    Text("Making a code…").font(.subheadline).foregroundStyle(.white.opacity(0.75))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 340)
            .padding(22)
            .glassEffect(.regular, in: .rect(cornerRadius: 34))
        }
    }

    private var lengths: some View {
        VStack(spacing: 10) {
            Text("How long they can listen").font(.subheadline.weight(.semibold)).foregroundStyle(.white.opacity(0.8))
            GlassEffectContainer(spacing: 10) {
                HStack(spacing: 10) {
                    ForEach(GuestLength.allCases) { length in
                        let chosen = length == invites.length
                        Button {
                            guard !chosen else { return }
                            Task { await invites.invite(length) }
                        } label: {
                            Text(length.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(chosen ? .black : .white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(chosen ? .regular.tint(Color.amber) : .regular, in: .capsule)
                        .accessibilityAddTraits(chosen ? .isSelected : [])
                    }
                }
            }
            .disabled(invites.making || invites.joined != nil)
        }
    }
}

/// Home's line for a guest: whose pass, and the time left.
struct GuestBanner: View {
    let pass: GuestPass

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            HStack(spacing: 12) {
                Image(systemName: "ticket.fill").font(.title3).foregroundStyle(Color.amber)
                VStack(alignment: .leading, spacing: 1) {
                    Text(pass.invitedBy.map { "You're \($0)'s guest" } ?? "You're a guest")
                        .font(.subheadline.weight(.semibold))
                    Text("\(PassText.left(until: pass.ends, now: context.date)) · listening only")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .glassEffect(.regular, in: .rect(cornerRadius: 20))
            .accessibilityElement(children: .combine)
        }
    }
}

/// Settings → Sign in and guests: scanning a computer's sign-in code (the iPhone's; the Mac says to
/// use the iPhone) and the guests; for a guest, its pass.
struct GuestSettings: View {
    let session: Session

    @State private var scanning: ScanFlow? = nil

    var body: some View {
        if let pass = session.guest {
            SettingsGroup(
                title: "Guest pass",
                footer: "A guest listens only: no likes, playlists or Wanted list. When the time is up, this guest account and what it played are deleted."
            ) {
                SettingsRow(label: "From", value: pass.invitedBy ?? "–")
                SettingsDivider()
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    SettingsRow(label: "Time left", value: PassText.left(until: pass.ends, now: context.date))
                }
            }
        } else {
            SettingsGroup(
                title: "Sign in and guests",
                footer: footer
            ) {
                #if os(iOS)
                Button {
                    scanning = ScanFlow(purpose: .signInComputer, session: session)
                } label: {
                    row("qrcode.viewfinder", "Sign in a computer")
                }
                .buttonStyle(.plain)
                SettingsDivider()
                #endif
                NavigationLink {
                    GuestsScreen()
                } label: {
                    row("person.2.fill", "Guests")
                }
                .buttonStyle(.plain)
            }
            #if os(iOS)
            .fullScreenCover(item: $scanning) { flow in
                ScanScreen(flow: flow) { scanning = nil }
            }
            #endif
        }
    }

    private var footer: String {
        #if os(iOS)
        "Sign in a computer: scan the QR code on ECHO's web sign-in page. Guests: let someone listen to your library for a while."
        #else
        "To sign in a computer, scan the QR code on ECHO's web sign-in page with ECHO on your iPhone (Settings → Sign in a computer). Guests: let someone listen to your library for a while."
        #endif
    }

    private func row(_ icon: String, _ title: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).foregroundStyle(Color.amber).frame(width: 24)
            Text(title)
            Spacer()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        .contentShape(.rect)
    }
}

extension ScanFlow: Identifiable {}
