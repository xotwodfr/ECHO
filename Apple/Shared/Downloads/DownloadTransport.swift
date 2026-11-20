import Foundation

// What fetches the files, behind a small protocol: a background URLSession in the iPhone app (the
// system goes on downloading when the app is closed, and relaunches it to say so), a plain one on
// the Mac, a fake in the tests and one that never fetches in the preview. Each fetch has a key
// ("t:<song id>", "c:<cover id>"), kept as the task's description so it is known again after a
// relaunch.

enum TransportEvent: Equatable, Sendable {
    /// Bytes so far; `expected` is 0 while the size is unknown.
    case progress(key: String, written: Int64, expected: Int64)
    /// The system finished a fetch: `file` is the body (moved out of the system's temporary place), with
    /// the HTTP status it came with. An error page is a body too: the manager checks the status.
    case finished(key: String, file: URL, status: Int)
    case failed(key: String, message: String)
}

@MainActor
protocol DownloadTransport: AnyObject {
    var onEvent: ((TransportEvent) -> Void)? { get set }
    func start(key: String, request: URLRequest)
    func cancel(key: String)
    func cancelAll()
    /// The keys of the fetches the system still has (asked once after a relaunch).
    func running() async -> Set<String>
}

/// What the app delegate hands over: the system's completion handler for a background session's
/// events, called once the session has told the app all it had (the iPhone's).
enum BackgroundDownloads {
    @MainActor static var completion: (() -> Void)?
}

/// The real transport: `URLSession` downloads whose delegate is this object, so a relaunch that makes
/// the session again with the same identifier gets the events of what finished meanwhile.
@MainActor
final class URLSessionTransport: NSObject, DownloadTransport, URLSessionDownloadDelegate {
    static let identifier = "com.folk3s.echo.downloads"

    var onEvent: ((TransportEvent) -> Void)? {
        didSet {
            guard let onEvent else { return }
            let waiting = pending
            pending = []
            for event in waiting { onEvent(event) }
        }
    }

    private var pending: [TransportEvent] = []
    private var session: URLSession!
    /// The fetches this process started, and the ones it found running after a relaunch.
    private var tasks: [String: URLSessionTask] = [:]
    private let staging: URL

    /// - Parameters:
    ///   - staging: where a finished body is moved to at once (the system's copy is deleted when the
    ///     delegate call returns).
    ///   - background: a background session (the iPhone's); the Mac and the tests use an ordinary one.
    init(staging: URL, background: Bool) {
        self.staging = staging
        super.init()
        let config: URLSessionConfiguration
        #if os(iOS)
        if background {
            config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
            config.sessionSendsLaunchEvents = true
            config.isDiscretionary = false
        } else {
            config = URLSessionConfiguration.default
        }
        #else
        config = URLSessionConfiguration.default
        #endif
        config.waitsForConnectivity = true
        config.httpMaximumConnectionsPerHost = 2
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    func start(key: String, request: URLRequest) {
        let task = session.downloadTask(with: request)
        task.taskDescription = key
        tasks[key]?.cancel()
        tasks[key] = task
        task.resume()
    }

    func cancel(key: String) {
        tasks[key]?.cancel()
        tasks[key] = nil
    }

    func cancelAll() {
        for task in tasks.values { task.cancel() }
        tasks = [:]
    }

    func running() async -> Set<String> {
        let session = self.session!
        let found: [URLSessionTask] = await withCheckedContinuation { continuation in
            session.getAllTasks { continuation.resume(returning: $0) }
        }
        var keys = Set<String>()
        for task in found where task.state == .running || task.state == .suspended {
            guard let key = task.taskDescription else { continue }
            tasks[key] = task
            keys.insert(key)
        }
        return keys
    }

    private func deliver(_ event: TransportEvent) {
        switch event {
        case .finished(let key, _, _), .failed(let key, _): tasks[key] = nil
        case .progress: break
        }
        if let onEvent { onEvent(event) } else { pending.append(event) }
    }

    private nonisolated func emit(_ event: TransportEvent) {
        Task { @MainActor in self.deliver(event) }
    }

    // MARK: - URLSession's delegate (its own queue)

    nonisolated func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
    ) {
        guard let key = downloadTask.taskDescription else { return }
        emit(.progress(key: key, written: totalBytesWritten, expected: max(0, totalBytesExpectedToWrite)))
    }

    nonisolated func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL
    ) {
        guard let key = downloadTask.taskDescription else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        let manager = FileManager.default
        let destination = staging.appendingPathComponent(UUID().uuidString, isDirectory: false)
        do {
            try manager.createDirectory(at: staging, withIntermediateDirectories: true)
            try manager.moveItem(at: location, to: destination)
        } catch {
            emit(.failed(key: key, message: "Couldn't keep the file."))
            return
        }
        emit(.finished(key: key, file: destination, status: status))
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let key = task.taskDescription else { return }
        // Cancelled here (a download removed): nothing to say.
        if (error as NSError).code == NSURLErrorCancelled { return }
        emit(.failed(key: key, message: (error as NSError).localizedDescription))
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in
            BackgroundDownloads.completion?()
            BackgroundDownloads.completion = nil
        }
    }
}
