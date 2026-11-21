#if os(iOS)
import AVFoundation
import SwiftUI
import VisionKit

/// What the scan screen looks through: the iPhone's camera, or (the demo screens, which the CI's
/// simulator draws) a drawn picture of a sign-in page's QR code: nothing reaches the camera then.
enum ScanCamera: Equatable {
    case live
    case demo
}

/// Scan a QR code (Settings → Sign in a computer; the sign-in page's Scan a guest pass): the camera
/// full-bleed, a glass title over it and the frame to aim with, and a glass card under it that
/// follows the scan (ScanFlow): what to point at and why the last code did not go, which browser
/// asks (Approve, Deny) or whose guest pass it is (Join), and how it ended.
struct ScanScreen: View {
    @Environment(\.theme) private var theme
    @State var flow: ScanFlow
    var camera: ScanCamera = .live
    let close: () -> Void

    @State private var access: CameraAccess = .asking
    @State private var codes = LiveCodes()

    /// Approving or joining: the buttons wait.
    private var busy: Bool {
        switch flow.step {
        case .approving, .joining: true
        default: false
        }
    }

    private var title: String {
        switch flow.purpose {
        case .signInComputer: "Sign in a computer"
        case .joinAsGuest: "Scan a guest pass"
        case .joinTogether: "Join a session"
        }
    }

    private var subtitle: String {
        switch flow.purpose {
        case .signInComputer: "On ECHO's web sign-in page"
        case .joinAsGuest: "The QR code your host shows"
        case .joinTogether: "The QR code the host shows"
        }
    }

    var body: some View {
        ZStack {
            viewfinderBackground
            LinearGradient(
                colors: [.black.opacity(0.55), .clear, .clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)
            ScanFrame(lit: flow.step == .scanning || flow.step == .checking)
                .frame(width: 250, height: 250)
                .offset(y: -40)
                .allowsHitTesting(false)
            VStack(spacing: 0) {
                header
                Spacer(minLength: 20)
                card
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
        }
        .themedDark()
        .animation(.smooth, value: flow.step)
        .animation(.smooth, value: flow.note)
        .task {
            guard camera == .live else { return }
            access = await CameraAccess.ask()
        }
        .task(id: access) {
            guard camera == .live, access == .allowed else { return }
            await flow.listen(to: codes)
        }
        .onChange(of: flow.step) {
            if flow.step == .joined { close() }
        }
    }

    @ViewBuilder private var viewfinderBackground: some View {
        switch camera {
        case .demo:
            DemoCameraView()
        case .live:
            switch access {
            case .allowed:
                LiveCamera(codes: codes).ignoresSafeArea()
            default:
                AlbumLight(strength: 0.5).ignoresSafeArea()
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            Button("Close", systemImage: "xmark", action: close)
                .labelStyle(.iconOnly)
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(.large)
                .tint(.white)
            Spacer()
            VStack(spacing: 2) {
                Text(title).font(.headline)
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.75))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 9)
            .glassEffect(.regular, in: .capsule)
            Spacer()
            // Balances the close button, so the title sits in the middle.
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: The card

    private var card: some View {
        VStack(alignment: .leading, spacing: 12) {
            stepContent
            if let note = flow.note {
                Text(note)
                    .font(.subheadline)
                    .foregroundStyle(theme.forcedDark.warning)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .glassEffect(.regular, in: .rect(cornerRadius: 30))
        .onChange(of: flow.note) {
            if let note = flow.note { AccessibilityNotification.Announcement(note).post() }
        }
    }

    @ViewBuilder private var stepContent: some View {
        switch flow.step {
        case .scanning:
            if camera == .live, access != .allowed {
                cameraProblem
            } else {
                switch flow.purpose {
                case .signInComputer:
                    line(
                        "qrcode.viewfinder", "Point the camera at the code",
                        "Open \(flow.session.server) on the computer. Its sign-in page shows a QR code.")
                case .joinAsGuest:
                    line(
                        "qrcode.viewfinder", "Point the camera at the guest pass",
                        "Whoever invites you shows it in ECHO: Settings → Guests → Invite a guest.")
                case .joinTogether:
                    line(
                        "qrcode.viewfinder", "Point the camera at the code",
                        "The host shows it in ECHO: Now Playing → Together. Your music then follows theirs.")
                }
            }
        case .checking:
            HStack(spacing: 12) {
                ProgressView().tint(.white)
                Text("Checking the code…").font(.headline)
            }
        case .computer(_, let peek), .approving(_, let peek):
            line(
                "laptopcomputer", "Sign in \(peek.browser)?",
                "From network \(peek.ip). It will be signed in as \(flow.session.account?.username ?? "you"). Only approve a sign-in you started yourself.")
            HStack(spacing: 10) {
                wide("Deny", prominent: false) { flow.deny() }
                    .disabled(busy)
                wide(busy ? "Signing in…" : "Approve", prominent: true) { Task { await flow.approve() } }
                    .disabled(busy)
            }
        case .approved(let browser):
            line("checkmark.circle.fill", "\(browser) is signed in", "It's in Sessions & devices on the web, where you can sign it out.")
            wide("Done", prominent: true, action: close)
        case .denied:
            line("xmark.circle", "Not signed in", "Nothing was sent. The computer's code runs out by itself in two minutes.")
            HStack(spacing: 10) {
                wide("Scan again", prominent: false) { flow.scanAgain() }
                wide("Done", prominent: true, action: close)
            }
        case .pass(_, let peek), .joining(_, let peek):
            line(
                "ticket.fill", "\(peek.invitedBy)'s guest pass",
                "Listen to \(peek.invitedBy)'s library for \(PassText.duration(ms: peek.durationMs)) on this phone. A guest listens only: no likes, playlists or Wanted list. When the time is up, the guest account and what it played are deleted.")
            HStack(spacing: 10) {
                wide("Cancel", prominent: false) { flow.scanAgain() }
                    .disabled(busy)
                wide(busy ? "Joining…" : "Join as guest", prominent: true) { Task { await flow.join() } }
                    .disabled(busy)
            }
        case .joined:
            line("checkmark.circle.fill", "You're in", "Opening ECHO…")
        }
    }

    @ViewBuilder private var cameraProblem: some View {
        switch access {
        case .denied:
            line("camera.fill", "ECHO can't use the camera", "Allow it in Settings → Apps → ECHO → Camera, then come back.")
            wide("Open Settings", prominent: true) {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            }
        case .unsupported:
            line("camera.fill", "This iPhone can't scan here", "Scanning needs the camera of an iPhone XS or later.")
        default:
            HStack(spacing: 12) {
                ProgressView().tint(.white)
                Text("Starting the camera…").font(.headline)
            }
        }
    }

    private func line(_ icon: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title2.weight(.semibold))
                .foregroundStyle(theme.forcedDark.highlight)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.75))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func wide(_ title: String, prominent: Bool, action: @escaping () -> Void) -> some View {
        let label = Text(title).font(.headline).frame(maxWidth: .infinity)
        if prominent {
            Button(action: action) { label.foregroundStyle(.white) }
                .buttonStyle(.glassProminent)
                .tint(theme.forcedDark.accent)
                .controlSize(.large)
        } else {
            Button(action: action) { label }
                .buttonStyle(.glass)
                .tint(.white)
                .controlSize(.large)
        }
    }
}

/// The frame to aim with: four white corners on the camera, and an amber line while it looks.
private struct ScanFrame: View {
    @Environment(\.theme) private var theme
    let lit: Bool

    var body: some View {
        ZStack {
            Corners()
                .stroke(.white, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                .shadow(color: .black.opacity(0.35), radius: 6)
            if lit {
                Capsule()
                    .fill(theme.forcedDark.highlight)
                    .frame(height: 3)
                    .padding(.horizontal, 26)
                    .shadow(color: theme.forcedDark.highlight.opacity(0.8), radius: 8)
            }
        }
    }

    private struct Corners: Shape {
        func path(in rect: CGRect) -> Path {
            let arm: CGFloat = 44
            let r: CGFloat = 22
            var p = Path()
            for (corner, dx, dy) in [
                (CGPoint(x: rect.minX, y: rect.minY), 1.0, 1.0), (CGPoint(x: rect.maxX, y: rect.minY), -1.0, 1.0),
                (CGPoint(x: rect.minX, y: rect.maxY), 1.0, -1.0), (CGPoint(x: rect.maxX, y: rect.maxY), -1.0, -1.0),
            ] {
                p.move(to: CGPoint(x: corner.x, y: corner.y + dy * arm))
                p.addLine(to: CGPoint(x: corner.x, y: corner.y + dy * r))
                p.addQuadCurve(to: CGPoint(x: corner.x + dx * r, y: corner.y), control: corner)
                p.addLine(to: CGPoint(x: corner.x + dx * arm, y: corner.y))
            }
            return p
        }
    }
}

/// The demo's camera: a laptop's sign-in page with its QR code, in a dim room, as a phone sees it.
private struct DemoCameraView: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x1B2330), Color(hex: 0x0B0D12)], startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [Color(hex: 0x3A4C66).opacity(0.7), .clear], center: .center, startRadius: 10, endRadius: 360)
            VStack(spacing: 14) {
                Text("ECHO").font(.system(size: 22, weight: .heavy)).tracking(4).foregroundStyle(.white.opacity(0.85))
                QRCodeView(text: "https://echo.folk3s.com/link#qr-request-for-tests-0001", label: "A sign-in page's QR code", mark: false)
                    .frame(width: 200)
                Text("Scan with ECHO on your phone").font(.footnote).foregroundStyle(.white.opacity(0.6))
            }
            .padding(30)
            .background(Color(hex: 0x141A24), in: .rect(cornerRadius: 18))
            .rotation3DEffect(.degrees(8), axis: (x: 1, y: -0.4, z: 0))
            .offset(y: -40)
            .blur(radius: 0.6)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

// MARK: - The camera

/// Whether ECHO may use the camera, and whether this iPhone can scan (VisionKit's data scanner
/// needs an A12 or later; the simulator has none).
enum CameraAccess: Equatable {
    case asking, allowed, denied, unsupported

    @MainActor static func ask() async -> CameraAccess {
        guard DataScannerViewController.isSupported else { return .unsupported }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .allowed
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video) ? .allowed : .denied
        default: return .denied
        }
    }
}

/// The codes the camera sees, as a QRCodeSource for ScanFlow.
final class LiveCodes: QRCodeSource, @unchecked Sendable {
    private let stream: AsyncStream<String>
    private let continuation: AsyncStream<String>.Continuation

    init() {
        let pair = AsyncStream.makeStream(of: String.self, bufferingPolicy: .bufferingNewest(1))
        stream = pair.stream
        continuation = pair.continuation
    }

    func codes() -> AsyncStream<String> { stream }

    func saw(_ text: String) { continuation.yield(text) }
}

/// VisionKit's data scanner, QR codes only, full-bleed under ECHO's own frame.
private struct LiveCamera: UIViewControllerRepresentable {
    let codes: LiveCodes

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
            recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false, isPinchToZoomEnabled: true,
            isGuidanceEnabled: false, isHighlightingEnabled: false)
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        if !scanner.isScanning, DataScannerViewController.isAvailable { try? scanner.startScanning() }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(codes: codes) }

    @MainActor final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let codes: LiveCodes

        init(codes: LiveCodes) { self.codes = codes }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            report(addedItems)
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didUpdate updatedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            report(updatedItems)
        }

        private func report(_ items: [RecognizedItem]) {
            for item in items {
                if case .barcode(let code) = item, let text = code.payloadStringValue { codes.saw(text) }
            }
        }
    }
}
#endif
