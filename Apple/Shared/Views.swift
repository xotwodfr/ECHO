import SwiftUI

/// Sign in, or the albums; the player bar under every page once something plays.
struct RootView: View {
    @State private var library = Library()

    var body: some View {
        Group {
            if library.signedIn {
                LibraryView(library: library)
            } else {
                SignInView(library: library)
            }
        }
        .task {
            if library.signedIn { await library.loadAlbums() }
        }
    }
}

/// The server's device token, the code in the same request when two-factor is on.
struct SignInView: View {
    let library: Library
    @State private var user = ""
    @State private var password = ""
    @State private var code = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 12) {
            Text("Sign in to ECHO").font(.title2.bold())
            Text(library.api.base).foregroundStyle(.secondary)
            TextField("Username", text: $user)
            #if os(iOS)
                .textInputAutocapitalization(.never)
            #endif
                .autocorrectionDisabled()
            SecureField("Password", text: $password)
            TextField("Authenticator code, if you use two-factor", text: $code)
            #if os(iOS)
                .keyboardType(.numberPad)
            #endif
            Button {
                Task {
                    busy = true
                    await library.signIn(user: user, password: password, code: code)
                    busy = false
                    if library.signedIn {
                        password = ""
                        code = ""
                    }
                }
            } label: {
                Text("Sign in").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .disabled(busy || user.isEmpty || password.isEmpty)
            if !library.message.isEmpty {
                Text(library.message).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
        }
        .textFieldStyle(.roundedBorder)
        .frame(maxWidth: 340)
        .padding()
    }
}

struct LibraryView: View {
    let library: Library

    var body: some View {
        NavigationStack {
            List(library.albums) { album in
                NavigationLink(value: album) {
                    VStack(alignment: .leading) {
                        Text(album.name).bold()
                        Text(album.artist).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Albums")
            .navigationDestination(for: Album.self) { AlbumView(library: library, album: $0) }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Sign out") { Task { await library.signOut() } }
                }
            }
            .overlay(alignment: .top) {
                if !library.status.isEmpty {
                    Text(library.status).foregroundStyle(.secondary).padding()
                }
            }
        }
        .safeAreaInset(edge: .bottom) { NowPlayingBar(library: library) }
    }
}

struct AlbumView: View {
    let library: Library
    let album: Album
    @State private var songs: [Song] = []

    var body: some View {
        List(Array(songs.enumerated()), id: \.element.id) { index, song in
            Button {
                Task { await library.play(songs, at: index) }
            } label: {
                VStack(alignment: .leading) {
                    Text("\(index + 1). \(song.title)").bold()
                    Text("\(song.artist) · \(mmss(song.seconds))").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .navigationTitle(album.name)
        .task { songs = await library.songs(of: album) }
    }
}

/// The song, its time, and play or pause.
struct NowPlayingBar: View {
    let library: Library

    var body: some View {
        if let index = library.current, library.queue.indices.contains(index) {
            let song = library.queue[index]
            HStack(spacing: 12) {
                VStack(alignment: .leading) {
                    Text(song.title).bold().lineLimit(1)
                    Text(song.artist).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text("\(mmss(Int(library.position))) / \(mmss(song.seconds))")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                Button {
                    library.toggle()
                } label: {
                    Image(systemName: library.playing ? "pause.fill" : "play.fill")
                }
                .buttonStyle(.borderless)
                .font(.title2)
                .accessibilityLabel(library.playing ? "Pause" : "Play")
            }
            .padding(.horizontal)
            .padding(.vertical, 10)
            .background(.bar)
        }
    }
}

func mmss(_ seconds: Int) -> String {
    String(format: "%d:%02d", seconds / 60, seconds % 60)
}
