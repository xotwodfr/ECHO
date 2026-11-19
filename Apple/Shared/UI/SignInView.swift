import SwiftUI

/// Sign in (iOS/README.md): username, password and the authenticator code go to the server in one
/// request; this device gets its own token, listed in Sessions & devices. With two-factor on and no
/// code given, the server answers `totp_required` and the code field asks for it. The room lit by
/// the album behind one glass card, the Echo mark over it, the server named under it.
struct SignInView: View {
    let session: Session

    @State private var username = ""
    @State private var password = ""
    @State private var code = ""
    @State private var busy = false
    @State private var message: String?
    @State private var needsCode = false
    @FocusState private var focus: Field?

    private enum Field: Hashable { case username, password, code }

    private var ready: Bool {
        !busy && !username.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
            && (!needsCode || !code.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 30) {
                    header
                    card
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
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
        #if os(macOS)
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        #endif
        .onAppear { message = message ?? session.notice }
    }

    private var header: some View {
        VStack(spacing: 10) {
            EchoMark()
                .frame(width: 92)
                .shadow(color: Color.amber.opacity(0.35), radius: 24)
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
                        RoundedRectangle(cornerRadius: 14).strokeBorder(Color.echoTint.opacity(0.8), lineWidth: 1.5)
                    }
                }

            if let message {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Color.echoWarning)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 2)
                    .transition(.opacity)
            }

            Button(action: submit) {
                HStack(spacing: 10) {
                    if busy { ProgressView().controlSize(.small).tint(.white) }
                    Text(busy ? "Signing in…" : "Sign in")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .tint(Color.echoAccent)
            .controlSize(.large)
            .font(.headline)
            .disabled(!ready)
            .keyboardShortcut(.defaultAction)
            .padding(.top, 4)
        }
        .padding(20)
        .glassEffect(.regular, in: .rect(cornerRadius: 30))
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
        guard ready else { return }
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
