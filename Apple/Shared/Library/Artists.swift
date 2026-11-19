import Foundation

/// A row of the Library's artists (the web's ArtistRow, src/client/shell/artists.ts).
struct ArtistRow: Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    var image: String?
    /// Their albums on the server.
    var albums: Int
    /// On the list only because the user follows them (hearted, `getStarred2`).
    var followedOnly: Bool
}

enum ArtistRows {
    /// The server's own artist list (`getArtists`), with the followed artists it lacks added, A–Z.
    static func merge(server: [Artist], followed: [Artist]) -> [ArtistRow] {
        var rows = server.map {
            ArtistRow(id: $0.id, name: $0.name, image: $0.image, albums: $0.albumCount ?? 0, followedOnly: false)
        }
        var have = Set(rows.map(\.id))
        for artist in followed where !have.contains(artist.id) {
            have.insert(artist.id)
            rows.append(ArtistRow(id: artist.id, name: artist.name, image: artist.image, albums: 0, followedOnly: true))
        }
        return rows.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}
