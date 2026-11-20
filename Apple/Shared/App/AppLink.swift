import Foundation

/// A link into the app (the iPhone's `echo://` scheme, iOS/project.yml): the widget opens Now
/// Playing with one (`widgetURL`). Plain Swift, so the widget extension and the tests have it too;
/// other links (a guest pass, a Listen together invitation) are added here as their tasks come.
enum AppLink: Equatable, Sendable {
    /// Now Playing, over whatever page is open (with nothing playing, the app as it is).
    case nowPlaying

    static let scheme = "echo"

    /// The link from a URL the system handed the app; nil for one that is not the app's.
    init?(_ url: URL) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }
        // echo://now-playing, and echo:now-playing as some writers shorten it.
        let place = (url.host() ?? url.path(percentEncoded: false)).lowercased()
        switch place {
        case "now-playing", "nowplaying": self = .nowPlaying
        default: return nil
        }
    }

    var url: URL {
        switch self {
        case .nowPlaying: URL(string: "\(Self.scheme)://now-playing")!
        }
    }
}
