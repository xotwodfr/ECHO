import SwiftUI

/// Sign in (iOS/README.md): username, password and the authenticator code go to the server in one
/// request; this device gets its own token, listed in Sessions & devices. With two-factor on and no
/// code given, the server answers `totp_required` and the code field asks for it. The room lit by
/// the album behind one glass card, the Echo mark over it, the server named under it. On the iPhone,
/// Scan a guest pass under it joins as a guest (ScanScreen), as a guest link does (AppLink.guest).
struct SignInView: View {
    let session: Session
    var link: Binding<AppLink?> = .constant(nil)
    @Environment(\.theme) private var theme
    /// The guest pass's scan, open over the page.
    @State private var scan: ScanFlow? = nil

    @State private var username = ""
    @State private var password = ""
    @State private var code = ""
    @State private var busy = false
    @State private var message: String?
    @State private var needsCode = false
    @FocusState private var focus: Field?

    private enum Field: Hashable { case username, password, code }

    /// The first field still to fill in, and what to say about it; nil when the form can go.
    private var missing: (field: Field, message: String)? {
        if username.trimmingCharacters(in: .whitespaces).isEmpty { return (.username, "Enter your username.") }
        if password.isEmpty { return (.password, "Enter your password.") }
        if needsCode && code.trimmingCharacters(in: .whitespaces).isEmpty {
            return (.code, ApiError.totpRequired.userMessage)
        }
        return nil
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 30) {
                    header
                    card
                    #if os(iOS)
                    guestPass
                    #endif
                }
                .frame(maxWidth: 400)
                .padding(.horizontal, 24)
                .padding(.vertical, 32)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
        }
        .background { AlbumLight() }
        .themedDark()
        #if os(macOS)
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        #endif
        .onAppear { message = message ?? session.notice }
        #if os(iOS)
        .fullScreenCover(item: $scan) { flow in
            ScanScreen(flow: flow) { scan = nil }
        }
        .task(id: link.wrappedValue) {
            // A guest link: its pass is checked as a scanned one would be, the camera behind it.
            guard case .guest? = link.wrappedValue, let url = link.wrappedValue?.url else { return }
            link.wrappedValue = nil
            let flow = ScanFlow(purpose: .joinAsGuest, session: session)
            scan = flow
            await flow.scanned(url.absoluteString)
        }
        #endif
    }

    #if os(iOS)
    /// Joining as a guest, with a pass someone shows.
    private var guestPass: some View {
        Button {
            scan = ScanFlow(purpose: .joinAsGuest, session: session)
        } label: {
            Label("Scan a guest pass", systemImage: "qrcode.viewfinder")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 8)
        }
        .buttonStyle(.glass)
        .tint(.white)
        .controlSize(.large)
    }
    #endif

    private var header: some View {
        VStack(spacing: 10) {
            EchoMark()
                .frame(width: 92)
                .shadow(color: theme.forcedDark.highlight.opacity(0.35), radius: 24)
                .padding(.bottom, 6)
            Text("ECHO")
                .font(.system(size: 46, weight: .heavy))
                .tracking(6)
            Text(session.server)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("ECHO, \(session.server)")
    }

    private var card: some View {
        VStack(spacing: 12) {
            field("Username", text: $username, focused: .username)
                #if os(iOS)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .submitLabel(.next)
                #endif
                .onSubmit { focus = .password }
            SecureField("Password", text: $password, prompt: prompt("Password"))
                .modifier(SignInField(focused: focus == .password))
                .focused($focus, equals: .password)
                #if os(iOS)
                .textContentType(.password)
                .submitLabel(needsCode ? .next : .go)
                #endif
                .onSubmit { if needsCode { focus = .code } else { submit() } }
            field(needsCode ? "Authenticator code" : "Authenticator code (if on)",
                  text: $code, focused: .code)
                #if os(iOS)
                .textContentType(.oneTimeCode)
                .textInputAutocapitalization(.never)
                .keyboardType(.asciiCapable)
                .submitLabel(.go)
                #endif
                .onSubmit(submit)
                .overlay {
                    if needsCode && code.isEmpty {
                        RoundedRectangle(cornerRadius: 14).strokeBorder(theme.forcedDark.tint.opacity(0.8), lineWidth: 1.5)
                    }
                }

            if let message {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(theme.forcedDark.warning)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 2)
                    .transition(.opacity)
            }

            // Always lit (a disabled prominent button is a dark slab on the glass, the Mac's nearly
            // black): pressed with a field empty, it says which one and goes there.
            Button(action: submit) {
                HStack(spacing: 10) {
                    if busy { ProgressView().controlSize(.small).tint(.white) }
                    Text(busy ? "Signing in…" : "Sign in")
                }
                // White on the amber, as on the iPhone (the Mac would tint it a pale amber), and
                // on the Mac as tall as the fields above it.
                .foregroundStyle(theme.forcedDark.onAccent)
                .frame(maxWidth: .infinity)
                #if os(macOS)
                .frame(minHeight: 34)
                #endif
            }
            .buttonStyle(.glassProminent)
            .tint(theme.forcedDark.accent)
            .controlSize(.large)
            .font(.headline)
            .keyboardShortcut(.defaultAction)
            .padding(.top, 4)
        }
        .padding(20)
        .themedGlass(30)
        .animation(.smooth, value: message)
        .animation(.smooth, value: needsCode)
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(.white.opacity(0.5))
    }

    private func field(_ title: String, text: Binding<String>, focused: Field) -> some View {
        TextField(title, text: text, prompt: prompt(title))
            .autocorrectionDisabled()
            .modifier(SignInField(focused: focus == focused))
            .focused($focus, equals: focused)
    }

    private func submit() {
        guard !busy else { return }
        if let missing {
            focus = missing.field
            show(missing.message)
            return
        }
        busy = true
        message = nil
        Task {
            defer { busy = false }
            do {
                try await session.signIn(username: username, password: password, code: code)
                password = ""
                code = ""
            } catch let error as ApiError {
                if error == .totpRequired {
                    needsCode = true
                    focus = .code
                } else if error == .badCode {
                    code = ""
                    focus = .code
                }
                show(error.userMessage)
            } catch {
                show(ApiError.unreachable.userMessage)
            }
        }
    }

    private func show(_ text: String) {
        message = text
        AccessibilityNotification.Announcement(text).post()
    }
}

/// A sign-in field: white text on a soft pane of the glass, its edge lit while it has the focus.
private struct SignInField: ViewModifier {
    let focused: Bool

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .frame(height: 50)
            .background(.white.opacity(focused ? 0.14 : 0.08), in: .rect(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(.white.opacity(focused ? 0.35 : 0.12), lineWidth: 1)
            }
    }
}
