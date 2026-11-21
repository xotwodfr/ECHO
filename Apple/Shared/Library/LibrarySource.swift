import Foundation

/// Where the library's screens get their music: the user's Navidrome through ECHO (EchoClient), or
/// the preview's built-in albums (`-ECHODemo`, Preview/DemoLibrary.swift), so a demo screen never
/// reaches the network. Covers are server paths as the models keep them; `coverBytes` loads one.
protocol LibrarySource: Sendable {
    func albumList(_ list: AlbumList, size: Int, offset: Int) async throws -> [Album]
    func album(id: String) async throws -> Album?
    func artists() async throws -> [Artist]
    func artist(id: String) async throws -> ArtistPage?
    func artistInfo(id: String, similar: Int) async throws -> ArtistInfo
    func topSongs(artist: String, count: Int) async throws -> [Track]
    func playlists() async throws -> [Playlist]
    func playlist(id: String) async throws -> PlaylistDetail?
    func starred() async throws -> Starred
    func search(_ query: String, artists: Int, albums: Int, songs: Int) async throws -> SearchResult
    func setStar(_ kind: StarKind, id: String, on: Bool) async throws
    func mixes(utcOffsetMinutes: Int) async throws -> [Mix]
    func wanted() async throws -> [WantedItem]
    func addWanted(_ text: String) async throws -> WantedItem
    func removeWanted(id: Int) async throws
    func karaokeSongs(limit: Int) async throws -> [Track]
    /// A cover's image bytes, from its server path.
    func coverBytes(_ path: String) async throws -> Data
}

extension EchoClient: LibrarySource {
    func coverBytes(_ path: String) async throws -> Data {
        try await fetch(path)
    }
}

/// Runs a call and keeps its outcome, an error as ApiError: for screens that load several things at
/// once and show what came.
func outcome<T: Sendable>(_ call: @Sendable () async throws -> T) async -> Result<T, ApiError> {
    do {
        let value = try await call()
        return .success(value)
    } catch let error as ApiError {
        return .failure(error)
    } catch is CancellationError {
        return .failure(.unreachable)
    } catch {
        return .failure(.badResponse)
    }
}
