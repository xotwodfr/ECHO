import SwiftUI

/// Who is signed in, to which server, and signing out (Settings grows from here in later tasks).
struct AccountView: View {
    let session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var signingOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Signed in") {
                    LabeledContent("Username", value: session.account?.username ?? "–")
                    LabeledContent("Server", value: session.server)
                }
                Section {
                    Button(role: .destructive) {
                        signingOut = true
                        Task {
                            await session.signOut()
                            signingOut = false
                        }
                    } label: {
                        HStack {
                            Text(signingOut ? "Signing out…" : "Sign out")
                            if signingOut {
                                Spacer()
                                ProgressView().controlSize(.small)
                            }
                        }
                    }
                    .disabled(signingOut)
                } footer: {
                    Text("This device leaves Sessions & devices on ECHO too.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Account")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 280)
        #endif
        .preferredColorScheme(.dark)
        .tint(Color.echoTint)
    }
}
