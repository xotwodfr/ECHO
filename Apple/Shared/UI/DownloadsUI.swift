import SwiftUI

// Downloads on screen (the Android app's ui/Downloads.kt): the button in an album's, a playlist's and
// Liked Songs' bar (an arrow to download, a ring that fills while it downloads, a filled disc once it
// is on the device), the same actions in their menus, the mark on a song, Library → Downloads, and
// Settings → Downloads. Everything here is optional about the Downloads model, so a screen drawn
// without it (a preview) simply has none.

// MARK: - Marks

/// A ring that fills as a download goes: amber over a faint track.
struct ProgressRing: View {
    var value: Double
    var lineWidth: CGFloat = 2.5

    var body: some View {
        ZStack {
            Circle().stroke(.white.opacity(0.25), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.04, min(1, value)))
                .stroke(Color.amber, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .accessibilityHidden(true)
    }
}

/// The small mark at the end of a song's row.
struct TrackDownloadMark: View {
    let state: TrackDownload

    var body: some View {
        switch state {
        case .none:
            EmptyView()
        case .done:
            Image(systemName: "arrow.down.circle.fill")
                .font(.caption)
                .foregroundStyle(Color.amber)
                .accessibilityLabel("Downloaded")
        case .downloading(let value):
            ProgressRing(value: value, lineWidth: 2)
                .frame(width: 14, height: 14)
                .accessibilityElement()
                .accessibilityLabel("Downloading")
        case .queued:
            Image(systemName: "arrow.down.circle")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Waiting to download")
        case .failed:
            Image(systemName: "exclamationmark.circle")
                .font(.caption)
                .foregroundStyle(Color.echoWarning)
                .accessibilityLabel("Download failed")
        }
    }
}

/// The Downloads tile: amber glass with a down arrow.
struct DownloadsArt: View {
    var corner: CGFloat = 10

    var body: some View {
        LinearGradient(
            colors: [Color(hex: 0xC4964A), Color(hex: 0xF6D48A)], startPoint: .topLeading, endPoint: .bottomTrailing
        )
        .aspectRatio(1, contentMode: .fit)
        .overlay {
            GeometryReader { g in
                Image(systemName: "arrow.down")
                    .font(.system(size: g.size.width * 0.38, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: g.size.width, height: g.size.height)
            }
        }
        .clipShape(.rect(cornerRadius: corner))
        .accessibilityHidden(true)
    }
}

// MARK: - The page's button and menu

/// An album's, a playlist's or Liked Songs' download button: tap to download (once the page has its
/// songs), tap the ring to cancel, tap the disc to remove it (after asking), tap the warning to try
/// again.
struct DownloadButton: View {
    let kind: DownloadKind
    let id: String
    /// What to download; nil while the page has no songs yet.
    let make: () -> DownloadItem?

    @Environment(Downloads.self) private var downloads: Downloads?
    @State private var asking = false

    var body: some View {
        if let downloads {
            let status = downloads.status(kind, id)
            Button {
                switch status.state {
                case .none: if let item = make() { downloads.download(item) }
                case .queued, .downloading: downloads.remove(kind, id)
                case .done: asking = true
                case .failed: downloads.retry(kind, id)
                }
            } label: {
                icon(status)
            }
            .disabled(status.state == .none && make() == nil)
            .accessibilityLabel(label(status))
            .confirmationDialog("Remove this download?", isPresented: $asking, titleVisibility: .visible) {
                Button("Remove Download", role: .destructive) { downloads.remove(kind, id) }
            } message: {
                Text("It stays in your library; it just won't play without a connection.")
            }
        }
    }

    @ViewBuilder private func icon(_ status: DownloadStatus) -> some View {
        switch status.state {
        case .none: Image(systemName: "arrow.down.circle")
        case .queued, .downloading: ProgressRing(value: status.progress).frame(width: 20, height: 20)
        case .done: Image(systemName: "arrow.down.circle.fill")
        case .failed: Image(systemName: "arrow.clockwise.circle")
        }
    }

    private func label(_ status: DownloadStatus) -> String {
        switch status.state {
        case .none: "Download"
        case .queued, .downloading: "Cancel download"
        case .done: "Downloaded. Remove download"
        case .failed: "Download failed. Try again"
        }
    }
}

/// Download, Cancel, Retry or Remove Download, for the menus (an album's, a playlist's, Liked Songs').
struct DownloadMenuItems: View {
    let kind: DownloadKind
    let id: String
    /// What to download: an album from a list has no songs until it is asked for them.
    let make: () async -> DownloadItem?

    @Environment(Downloads.self) private var downloads: Downloads?

    var body: some View {
        if let downloads {
            switch downloads.status(kind, id).state {
            case .none:
                Button("Download", systemImage: "arrow.down.circle") {
                    Task { if let item = await make() { downloads.download(item) } }
                }
            case .queued, .downloading:
                Button("Cancel Download", systemImage: "xmark.circle") { downloads.remove(kind, id) }
            case .failed:
                Button("Try Download Again", systemImage: "arrow.clockwise") { downloads.retry(kind, id) }
                Button("Remove Download", systemImage: "trash") { downloads.remove(kind, id) }
            case .done:
                Button("Remove Download", systemImage: "trash") { downloads.remove(kind, id) }
            }
        }
    }
}

// MARK: - Library → Downloads

/// Library → Downloads: each download with its size or progress, Play, a menu, the total and Remove
/// all. It works offline: it is the downloaded copy.
struct DownloadsScreen: View {
    @Environment(Downloads.self) private var downloads
    @Environment(Player.self) private var player
    @Environment(Session.self) private var session
    @State private var removingAll = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !session.connectivity.isOnline {
                    offlineNote
                }
                if downloads.isEmpty {
                    NoteCard(
                        icon: "arrow.down.circle", title: "Nothing downloaded yet",
                        text: "Download an album, a playlist or Liked Songs from its page, and it plays with no connection.")
                } else {
                    totals
                    LazyVStack(spacing: 0) {
                        ForEach(downloads.items, id: \.key) { item in row(item) }
                    }
                }
            }
            .padding(.horizontal, pagePadding)
            .padding(.top, 4)
            .padding(.bottom, 32)
        }
        .echoRoom(strength: 0.55, height: 560)
        .navigationTitle("Downloads")
        .clearBars()
        .confirmationDialog("Remove all downloads?", isPresented: $removingAll, titleVisibility: .visible) {
            Button("Remove All Downloads", role: .destructive) { downloads.removeAll() }
        } message: {
            Text("They can be downloaded again while you're online.")
        }
    }

    private var offlineNote: some View {
        HStack(spacing: 12) {
            Image(systemName: "wifi.slash").font(.title3).foregroundStyle(Color.amber)
            VStack(alignment: .leading, spacing: 1) {
                Text("Offline").font(.subheadline.weight(.semibold))
                Text("Your downloads still play.").font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .accessibilityElement(children: .combine)
    }

    private var totals: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("On this device").font(.headline)
                Text(downloads.summary).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Button("Remove All", role: .destructive) { removingAll = true }
                .echoGlass()
        }
        .padding(.horizontal, 4)
    }

    private func row(_ item: DownloadItem) -> some View {
        let status = downloads.status(item.kind, item.id)
        return HStack(spacing: 4) {
            NavigationLink(value: route(item)) {
                LibraryRow(
                    title: item.title, subtitle: DownloadText.line(item, status: status, bytes: downloads.bytes(of: item))
                ) {
                    art(item)
                }
            }
            .buttonStyle(.plain)
            if status.state == .downloading || status.state == .queued {
                ProgressRing(value: status.progress).frame(width: 22, height: 22).padding(.horizontal, 8)
            }
            Menu {
                Button("Play", systemImage: "play.fill") { Task { await play(item) } }
                    .disabled(status.done == 0)
                DownloadMenuItems(kind: item.kind, id: item.id) { item }
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: 36, height: 44)
                    .contentShape(.rect)
            }
            .menuIndicator(.hidden)
            .accessibilityLabel("More")
        }
    }

    @ViewBuilder private func art(_ item: DownloadItem) -> some View {
        switch item.kind {
        case .liked: LikedArt()
        case .playlist: Cover(path: item.cover, corner: 10, symbol: "music.note.list")
        case .album: Cover(path: item.cover, corner: 10)
        }
    }

    private func route(_ item: DownloadItem) -> Route {
        switch item.kind {
        case .album: .album(item.asAlbum)
        case .playlist: .playlist(item.asPlaylist.playlist)
        case .liked: .liked
        }
    }

    /// What of it is on the device, from the first song.
    private func play(_ item: DownloadItem) async {
        let here = item.tracks.filter { downloads.isDownloaded($0) }
        guard !here.isEmpty else { return }
        let context: PlayContext
        switch item.kind {
        case .album: context = PlayContext(kind: "album", id: item.id, title: item.title)
        case .playlist: context = PlayContext(kind: "playlist", id: item.id, title: item.title)
        case .liked: context = PlayContext(kind: "starred", title: item.title)
        }
        await player.play(here, at: 0, context: context)
    }
}

// MARK: - Settings → Downloads

/// Settings → Downloads: Wi-Fi only, the storage used, each download with its size and a way to
/// remove it, and Remove all.
struct DownloadsSettings: View {
    @Environment(Downloads.self) private var downloads
    @Environment(DeviceSettings.self) private var device
    @State private var removingAll = false

    var body: some View {
        SettingsGroup(
            title: "Downloads",
            footer: "Downloaded songs play with no connection, from storage only ECHO uses. They are not backed up, and signing out removes them."
        ) {
            Toggle(
                "Download only on Wi-Fi",
                isOn: Binding(get: { device.downloadWifiOnly }, set: { device.setDownloadWifiOnly($0) })
            )
            .tint(Color.echoTint)
            .padding(.vertical, 6)
            SettingsDivider()
            SettingsRow(label: "Storage used", value: DownloadText.bytes(downloads.bytes))
            ForEach(downloads.items, id: \.key) { item in
                SettingsDivider()
                itemRow(item)
            }
            if !downloads.isEmpty {
                SettingsDivider()
                Button(role: .destructive) {
                    removingAll = true
                } label: {
                    HStack {
                        Text("Remove all downloads")
                        Spacer()
                    }
                    .padding(.vertical, 6)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.echoWarning)
            }
        }
        .confirmationDialog("Remove all downloads?", isPresented: $removingAll, titleVisibility: .visible) {
            Button("Remove All Downloads", role: .destructive) { downloads.removeAll() }
        } message: {
            Text("They can be downloaded again while you're online.")
        }
    }

    private func itemRow(_ item: DownloadItem) -> some View {
        let status = downloads.status(item.kind, item.id)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).lineLimit(1)
                Text(DownloadText.line(item, status: status, bytes: downloads.bytes(of: item)))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                downloads.remove(item.kind, item.id)
            } label: {
                Image(systemName: "trash").frame(width: 36, height: 36).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Remove \(item.title)")
        }
        .padding(.vertical, 2)
    }
}
