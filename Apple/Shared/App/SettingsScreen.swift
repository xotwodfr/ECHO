import SwiftUI

/// Settings: on the iPhone a page in the room (Home's account button), on the Mac its own window
/// (the app menu's Settings…, ⌘, and the toolbar's button). One column of groups, each a title over
/// a glass card (SettingsGroup), as the approved preview's pages are laid out: the album-lit room
/// under the status bar, no bar backgrounds, white on glass, amber for what is chosen.
///
/// The groups, in order: Appearance (motion, the background's brightness, Performance mode; the
/// themes of task 11b go first in it), Playback, Lyrics, Lock screen (the iPhone's animated cover
/// and its speed), Sign in and guests (scanning a computer's code, the guests; a guest's own pass),
/// Account, About. What follows the user is `/me/settings` (UserSettings, Session, changed through
/// SettingsEditor); what is this device's is DeviceSettings. The table of every setting and where it
/// is kept: docs/superpowers/plans/apple-settings-parity.md.
struct SettingsScreen: View {
    @Environment(Session.self) private var session
    @Environment(DeviceSettings.self) private var device
    @Environment(Karaoke.self) private var karaoke
    @Environment(\.settingsScroll) private var scrollTo
    @Environment(\.theme) private var theme
    @State private var editor: SettingsEditor?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    if let editor {
                        AppearanceSettings(session: session, editor: editor, device: device)
                            .id(SettingsAnchor.appearance)
                        PlaybackSettings(session: session, editor: editor, device: device)
                            .id(SettingsAnchor.playback)
                        KaraokeSettings(karaoke: karaoke)
                            .id(SettingsAnchor.karaoke)
                        LyricsSettings(session: session, editor: editor)
                            .id(SettingsAnchor.lyrics)
                        if let failure = editor.failure {
                            Text(failure)
                                .font(.footnote)
                                .foregroundStyle(theme.warning)
                                .padding(.horizontal, 4)
                        }
                    }
                    #if os(iOS)
                    LockScreenSettings()
                    #endif
                    GuestSettings(session: session)
                    AccountSettings(session: session)
                    AboutSettings()
                }
                .padding(.horizontal, pagePadding)
                .padding(.top, 4)
                .padding(.bottom, 40)
            }
            .task {
                guard let scrollTo else { return }
                try? await Task.sleep(for: .milliseconds(400))
                proxy.scrollTo(scrollTo, anchor: .top)
            }
        }
        .onAppear { if editor == nil { editor = SettingsEditor(session: session) } }
        .echoRoom(strength: 0.5, height: 520)
        .navigationTitle("Settings")
        .clearBars()
    }
}

/// A group of settings: its title, a glass card with its rows, and a line under it.
struct SettingsGroup<Content: View>: View {
    let title: String
    var footer: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.title3.bold())
                .padding(.leading, 4)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 0) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .themedGlass(26)
            if let footer {
                Text(footer)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A line of a group: a name and its value.
struct SettingsRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
            Spacer(minLength: 8)
            Text(value)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

/// The hairline between a group's rows, light on the glass.
struct SettingsDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.primary.opacity(0.12))
            .frame(height: 1)
            .padding(.vertical, 6)
    }
}

/// Who is signed in, to which server, and signing out (this device leaves Sessions & devices).
struct AccountSettings: View {
    let session: Session
    @State private var signingOut = false
    @Environment(\.theme) private var theme

    var body: some View {
        SettingsGroup(
            title: "Account",
            footer: "Connections, two-factor sign-in and devices are managed in ECHO on the web. Signing out ends this device's session there too."
        ) {
            SettingsRow(label: "Signed in as", value: session.account?.username ?? "–")
            SettingsDivider()
            SettingsRow(label: "Server", value: session.server)
            SettingsDivider()
            Button(role: .destructive) {
                signingOut = true
                Task {
                    await session.signOut()
                    signingOut = false
                }
            } label: {
                HStack {
                    Text(signingOut ? "Signing out…" : "Sign out")
                    Spacer()
                    if signingOut { ProgressView().controlSize(.small) }
                }
                .padding(.vertical, 6)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.warning)
            .disabled(signingOut)
        }
    }
}

/// The app's version and what it is.
struct AboutSettings: View {
    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "–"
    }

    private var device: String {
        #if os(iOS)
        "iPhone"
        #else
        "Mac"
        #endif
    }

    var body: some View {
        SettingsGroup(
            title: "About",
            footer: "Free software under the AGPL-3.0. Your music stays on your Navidrome; ECHO reaches it through your own server."
        ) {
            SettingsRow(label: "ECHO for \(device)", value: version)
        }
    }
}

#if os(macOS)
/// The Mac's Settings window: the same groups (the lock screen's is the iPhone's alone); `guests`
/// opens it on Guests (the `-ECHODemo guests` screen).
struct SettingsWindow: View {
    let session: Session
    let invites: GuestInvites
    let device: DeviceSettings
    let karaoke: Karaoke
    var guests = false
    /// The preview: the group Settings opens scrolled to.
    var scroll: String? = nil

    var body: some View {
        NavigationStack {
            if guests {
                GuestsScreen()
            } else {
                SettingsScreen()
            }
        }
        .environment(session)
        .environment(invites)
        .environment(device)
        .environment(karaoke)
        .environment(\.settingsScroll, scroll)
        .frame(width: 520, height: guests ? 560 : 640)
        .themed(session.settings.appearance)
    }
}
#endif
