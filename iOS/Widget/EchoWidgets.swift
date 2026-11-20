import SwiftUI
import UIKit
import WidgetKit

/// ECHO's widget extension (the iPhone's home screen): what plays, small and medium. The app writes
/// what plays into the App Group (WidgetFeed) and reloads the timelines when it changes; the widget
/// reads it here (WidgetStore) and draws it (NowPlayingWidgetView). Its buttons are App Intents the
/// system runs in the app's process (WidgetIntents.swift).
@main
struct EchoWidgets: WidgetBundle {
    var body: some Widget {
        NowPlayingWidget()
    }
}

struct NowPlayingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetShared.kind, provider: NowPlayingProvider()) { entry in
            NowPlayingWidgetView(entry: entry)
        }
        .configurationDisplayName("Now Playing")
        .description("What's playing in ECHO, with play and pause.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

/// The timeline from what the app last wrote (WidgetTimeline): the song now, and stopped at its end
/// should the app say nothing more by then. The app reloads it when what plays changes, so it never
/// asks to be reloaded itself.
struct NowPlayingProvider: TimelineProvider {
    private let store = WidgetStore.appGroup()

    func placeholder(in context: Context) -> NowPlayingEntry {
        NowPlayingEntry(date: Date(), snapshot: WidgetTimeline.sample, cover: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (NowPlayingEntry) -> Void) {
        // The gallery shows the example until something has played.
        let shown = store.read() ?? (context.isPreview ? WidgetTimeline.sample : nil)
        completion(entry(WidgetTimeline.moments(for: shown, now: Date())[0]))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NowPlayingEntry>) -> Void) {
        let moments = WidgetTimeline.moments(for: store.read(), now: Date())
        completion(Timeline(entries: moments.map(entry), policy: .never))
    }

    private func entry(_ moment: WidgetTimeline.Moment) -> NowPlayingEntry {
        let cover = moment.snapshot?.cover
            .flatMap(store.coverURL)
            .flatMap { UIImage(contentsOfFile: $0.path(percentEncoded: false)) }
        return NowPlayingEntry(date: moment.date, snapshot: moment.snapshot, cover: cover)
    }
}
