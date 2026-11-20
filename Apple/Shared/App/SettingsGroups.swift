import SwiftUI

// The groups of Settings that hold choices, as the web (SettingsViews.tsx) and Android group them:
// Appearance, Playback, Lyrics. Each setting is one of two kinds, and the table that says which is
// docs/superpowers/plans/apple-settings-parity.md: the user's (`/me/settings`, UserSettings, changed
// one key at a time through SettingsEditor) or this device's (DeviceSettings).

/// Where Settings opens scrolled to ("playback", "lyrics"): the preview's screenshots.
extension EnvironmentValues {
    @Entry var settingsScroll: String? = nil
}

/// The ids Settings scrolls to.
enum SettingsAnchor {
    static let appearance = "appearance"
    static let playback = "playback"
    static let lyrics = "lyrics"
}

// MARK: - Controls

/// A line of a group that is on or off, with what it does under it.
struct SettingsToggle: View {
    let title: String
    var detail: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(title, isOn: $isOn).tint(Color.echoTint)
            if let detail { SettingsHint(detail) }
        }
        .padding(.vertical, 4)
    }
}

/// A line of a group with a choice among a few: the name on the left, the choice on the right.
struct SettingsChoice<Value: Hashable>: View {
    let title: String
    var detail: String? = nil
    let options: [Value]
    let name: (Value) -> String
    @Binding var selection: Value

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Picker(title, selection: $selection) {
                ForEach(options, id: \.self) { Text(name($0)).tag($0) }
            }
            .pickerStyle(.menu)
            .tint(.white)
            if let detail { SettingsHint(detail) }
        }
        .padding(.vertical, 2)
    }
}

/// The small print under a setting.
struct SettingsHint: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Appearance

/// Settings → Appearance: how ECHO looks and moves. Themes (task 11b) come first in this group:
/// a ThemePicker, then the light or dark choice (`UserSettings.appearance`, the user's); what is
/// here is what the preferences cover already: motion, the background's brightness and Performance mode.
struct AppearanceSettings: View {
    let session: Session
    let editor: SettingsEditor
    let device: DeviceSettings

    var body: some View {
        SettingsGroup(
            title: "Appearance",
            footer: "Motion follows your account. Background brightness and Performance mode are for this device only."
        ) {
            SettingsChoice(
                title: "Motion",
                detail: "System follows Reduce Motion in the accessibility settings. Off shows the lyrics as a still sheet.",
                options: UserSettings.Motion.allCases, name: { SettingsText.motion($0) },
                selection: Binding(
                    get: { session.settings.visuals.motion },
                    set: { value in editor.save { $0.visuals.motion = value } }))
            SettingsDivider()
            SettingsToggle(
                title: "Performance mode",
                detail: "For a slower device: smaller animations everywhere. The lyrics still move word by word.",
                isOn: Binding(get: { device.performance }, set: { device.setPerformance($0) }))
            SettingsDivider()
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Background brightness")
                    Spacer()
                    Text("\(Int((device.backdrop * 100).rounded()))%").foregroundStyle(.secondary).monospacedDigit()
                }
                Slider(value: Binding(get: { device.backdrop }, set: { device.setBackdrop($0) }), in: 0...1, step: 0.05)
                    .tint(Color.echoTint)
                    .accessibilityLabel("Background brightness")
                SettingsHint("How bright the album's light is behind every page.")
            }
            .padding(.vertical, 4)
        }
    }
}

// MARK: - Playback

/// Settings → Playback: ReplayGain and scrobbling follow the user; the stream quality is this
/// device's own.
struct PlaybackSettings: View {
    let session: Session
    let editor: SettingsEditor
    let device: DeviceSettings

    var body: some View {
        SettingsGroup(title: "Playback") {
            SettingsChoice(
                title: "ReplayGain",
                detail: "Evens out the loudness between songs. Auto uses the album's level inside an album and the song's elsewhere.",
                options: UserSettings.ReplayGainMode.allCases, name: { SettingsText.replayGain($0) },
                selection: Binding(
                    get: { session.settings.playback.replayGain },
                    set: { value in editor.save { $0.playback.replayGain = value } }))
            SettingsDivider()
            SettingsChoice(
                title: "Quality",
                detail: "This device only. Auto plays a song as stored where this device can, and as MP3 at 320 kbit/s where it cannot. Applies to the next song.",
                options: StreamQuality.allCases, name: { $0.label },
                selection: Binding(get: { device.streamQuality }, set: { device.setStreamQuality($0) }))
            SettingsDivider()
            SettingsToggle(
                title: "Scrobble plays to Navidrome",
                isOn: Binding(
                    get: { session.settings.playback.scrobble },
                    set: { value in editor.save { $0.playback.scrobble = value } }))
        }
    }
}

// MARK: - Lyrics

/// Settings → Lyrics: the size, the timing offset for every song, unsynced lyrics, VoiceOver and
/// the sources asked (all the user's).
struct LyricsSettings: View {
    let session: Session
    let editor: SettingsEditor

    private var offset: Int { session.settings.lyrics.globalOffsetMs }

    var body: some View {
        SettingsGroup(
            title: "Lyrics",
            footer: "ECHO asks every source that is on and shows the best timing it finds: word by word first, then line by line."
        ) {
            SettingsChoice(
                title: "Lyric size", options: SettingsText.sizes, name: { SettingsText.size($0) },
                selection: Binding(
                    get: { session.settings.lyrics.sizeScale },
                    set: { value in editor.save { $0.lyrics.sizeScale = value } }))
            SettingsDivider()
            VStack(alignment: .leading, spacing: 4) {
                Stepper(
                    value: Binding(
                        get: { offset },
                        set: { value in editor.save { $0.lyrics.globalOffsetMs = SettingsText.clampOffset(value) } }),
                    in: -SettingsText.maxOffset...SettingsText.maxOffset, step: SettingsText.offsetStep
                ) {
                    HStack {
                        Text("Timing offset")
                        Spacer(minLength: 8)
                        Text(SettingsText.offset(offset)).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                SettingsHint("For all songs. Positive shows the words later.")
            }
            .padding(.vertical, 4)
            SettingsDivider()
            SettingsToggle(
                title: "Show lyrics without timing",
                isOn: Binding(
                    get: { session.settings.lyrics.showUnsynced },
                    set: { value in editor.save { $0.lyrics.showUnsynced = value } }))
            SettingsDivider()
            SettingsToggle(
                title: "Announce lyric lines",
                detail: "VoiceOver reads each line as it begins.",
                isOn: Binding(
                    get: { session.settings.lyrics.announceLines },
                    set: { value in editor.save { $0.lyrics.announceLines = value } }))
            SettingsDivider()
            Text("Lyric sources").font(.subheadline.weight(.semibold)).padding(.top, 2)
            ForEach(UserSettings.LyricSource.allCases, id: \.self) { source in
                SettingsToggle(
                    title: SettingsText.source(source),
                    isOn: Binding(
                        get: { !session.settings.lyrics.disabledSources.contains(source) },
                        set: { on in
                            editor.save { $0.lyrics.disabledSources = SettingsText.sources($0.lyrics.disabledSources, source, on: on) }
                        }))
            }
        }
    }
}
