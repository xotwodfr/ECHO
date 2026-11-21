import Foundation

/// Where the player's controls go while it follows a Listen together session (Together/Together.swift):
/// the transport, the queue and a song picked from a list are the session's, not this player's own,
/// as on the web (`RemoteQueue`) and Android (`Playback.remote`). The lock screen, Control Center,
/// the widget and the media keys come through the same methods, since they call the player's.
@MainActor
protocol PlayerRemote: AnyObject {
    /// Play or Pause (the host's: a member is told only the host controls playback).
    func togglePlaying()
    func setPlaying(_ on: Bool)
    func skipNext()
    func skipPrevious()
    func seek(to seconds: Double)
    /// Add to the shared queue, next or at the end (anyone in the session).
    func playNext(_ tracks: [Track], label: String?)
    func addToQueue(_ tracks: [Track], label: String?)
    /// A song picked from a list: the host plays it now, a member adds it to the end.
    func play(_ tracks: [Track], at index: Int)
    /// The song that plays here ended: the host's player tells the session.
    func songEnded()
    /// Whether Next has somewhere to go (a member's stays on, to say who controls).
    var canGoNext: Bool { get }
}
