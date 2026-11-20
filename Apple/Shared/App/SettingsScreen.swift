import SwiftUI

/// Settings: on the iPhone a page in the room (Home's account button), on the Mac its own window
/// (the app menu's Settings…, ⌘, and the toolbar's button). One column of groups, each a title over
/// a glass card (SettingsGroup), as the approved preview's pages are laid out: the album-lit room
/// under the status bar, no bar backgrounds, white on glass, amber for what is chosen.
///
/// The groups, in order: Lock screen (the iPhone's animated cover and its speed), Account, About.
/// Later groups go between Lock screen and Account, each a view of its own wrapped in a
/// SettingsGroup: Appearance (task 11, the themes; they follow the user, `/me/settings`, Session)
/// and Downloads (task 10, the storage used and freed; this device's own, DeviceSettings).
struct SettingsScreen: View {
    @Environment(Session.self) private var session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                #if os(iOS)
                LockScreenSettings()
                #endif
                AccountSettings(session: session)
                AboutSettings()
            }
            .padding(.horizontal, pagePadding)
            .padding(.top, 4)
            .padding(.bottom, 40)
        }
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
                .glassEffect(.regular, in: .rect(cornerRadius: 26))
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
            .fill(.white.opacity(0.12))
            .frame(height: 1)
            .padding(.vertical, 6)
    }
}

/// Who is signed in, to which server, and signing out (this device leaves Sessions & devices).
struct AccountSettings: View {
    let session: Session
    @State private var signingOut = false

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
            .foregroundStyle(Color.echoWarning)
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
/// The Mac's Settings window: the same groups (the lock screen's is the iPhone's alone).
struct SettingsWindow: View {
    let session: Session

    var body: some View {
        NavigationStack {
            SettingsScreen()
        }
        .environment(session)
        .frame(width: 500, height: 430)
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
    }
}
#endif
