import Foundation

/// A link into the app (the iPhone's `echo://` scheme, iOS/project.yml): the widget opens Now
/// Playing with one (`widgetURL`). Plain Swift, so the widget extension and the tests have it too;
/// other links (a Listen together invitation) are added here as their tasks come.
enum AppLink: Equatable, Sendable {
    /// Now Playing, over whatever page is open (with nothing playing, the app as it is).
    case nowPlaying
    /// A guest pass (`echo://guest#<code>`, the web's `/guest#<code>` in the app's scheme): signed
    /// out, the sign-in page checks it and offers to join; signed in, the scanner says why not.
    case guest(code: String)

    static let scheme = "echo"

    /// The link from a URL the system handed the app; nil for one that is not the app's.
    init?(_ url: URL) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }
        // echo://now-playing, and echo:now-playing as some writers shorten it; echo://guest#<code>,
        // echo://guest/<code> or echo://guest?code=<code>.
        let path = url.path(percentEncoded: false).split(separator: "/").map(String.init)
        let parts = (url.host().map { [$0] } ?? []) + path
        switch parts.first?.lowercased() {
        case "now-playing", "nowplaying": self = .nowPlaying
        case "guest":
            let code = url.fragment(percentEncoded: false)
                ?? URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "code" }?.value
                ?? parts.dropFirst().first
            guard let code, Self.isCode(code) else { return nil }
            self = .guest(code: code)
        default: return nil
        }
    }

    /// The codes the server makes (base64url, 16 to 64 characters).
    static func isCode(_ s: String) -> Bool {
        (16...64).contains(s.count) && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }

    var url: URL {
        switch self {
        case .nowPlaying: URL(string: "\(Self.scheme)://now-playing")!
        case .guest(let code): URL(string: "\(Self.scheme)://guest#\(code)")!
        }
    }
}
