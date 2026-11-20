import CoreGraphics
import Foundation

/// The app's side of the iPhone's home-screen widget: what plays, written into the App Group's
/// folder (WidgetStore) from the values the lock screen is given at the same moment (Player.publish
/// calls both), and the widget's timelines reloaded when what it shows changes (a song, play or
/// pause, a seek, the cover arriving), never as the song plays on: the widget's progress runs by
/// itself from the song's start. Signing out empties the folder. With no App Group container
/// (WidgetStore.isAvailable false) it does nothing at all.
@MainActor
final class WidgetFeed {
    let store: WidgetStore
    let reloads: WidgetReloads
    /// What the widget was last given; nil: nothing playing.
    private(set) var shown: WidgetSnapshot?
    /// The playing album's cover in the folder: its server path, its file's name and its colours.
    private var cover: (path: String, name: String?, palette: AlbumPalette?)?

    /// - Parameter reload: tells WidgetKit to read the folder again (the app's:
    ///   `WidgetCenter.shared.reloadTimelines(ofKind:)`).
    init(
        store: WidgetStore,
        reload: @escaping @MainActor () -> Void,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping () -> Date = { Date() }
    ) {
        self.store = store
        reloads = WidgetReloads(reload: reload, sleep: sleep, now: now)
    }

    /// What plays: `elapsed` seconds in at `date`, as the lock screen was told; `playing` shows
    /// Pause, `advancing` runs the progress; `artwork` the cover once it has loaded.
    func show(
        track: Track, elapsed: Double, at date: Date, duration: Double, playing: Bool, advancing: Bool,
        artwork: CGImage?
    ) {
        guard store.isAvailable else { return }
        // The album's cover, once: drawn small into the folder, and its colours for the background.
        if let path = track.cover, let artwork, cover?.path != path {
            cover = (path, store.storeCover(artwork, for: path), AlbumPalette(artwork))
        }
        let album = track.cover != nil && cover?.path == track.cover ? cover : nil
        let snapshot = WidgetSnapshot(
            key: track.key, title: track.title, artist: track.artist, album: track.album.title,
            palette: album?.palette, playing: playing, advancing: advancing, position: elapsed, positionAt: date,
            duration: duration, cover: album?.name)
        if let shown, shown.showsSame(as: snapshot) { return }
        guard store.write(snapshot) else { return }
        shown = snapshot
        reloads.request()
    }

    /// The queue emptied: the widget shows nothing playing.
    func showNothing() {
        guard shown != nil else { return }
        clear()
    }

    /// Signing out: what plays and the cover go (what an earlier launch left too), and the widget
    /// shows nothing playing.
    func clear() {
        guard store.isAvailable else { return }
        store.clear()
        shown = nil
        cover = nil
        reloads.request()
    }
}

/// When the widget's timelines are reloaded: at once, unless the last reload was under a second ago;
/// then once that second is up, however many changes came meanwhile (the last of them is what the
/// widget reads). Skipping through songs costs one reload a second at most.
@MainActor
final class WidgetReloads {
    static let interval: TimeInterval = 1

    private let reload: @MainActor () -> Void
    private let sleep: @Sendable (Duration) async throws -> Void
    private let now: () -> Date
    private var last: Date?
    private var pending: Task<Void, Never>?
    /// How many reloads there have been (the tests').
    private(set) var count = 0

    init(
        reload: @escaping @MainActor () -> Void, sleep: @escaping @Sendable (Duration) async throws -> Void,
        now: @escaping () -> Date
    ) {
        self.reload = reload
        self.sleep = sleep
        self.now = now
    }

    /// What the widget shows changed.
    func request() {
        // A reload is coming already: it reads this change too.
        guard pending == nil else { return }
        let date = now()
        guard let last, date.timeIntervalSince(last) < Self.interval else {
            fire()
            return
        }
        let wait = Self.interval - date.timeIntervalSince(last)
        let sleep = self.sleep
        pending = Task { [weak self] in
            try? await sleep(.milliseconds(Int((wait * 1000).rounded(.up))))
            guard let self, !Task.isCancelled else { return }
            self.pending = nil
            self.fire()
        }
    }

    private func fire() {
        last = now()
        count += 1
        reload()
    }
}
