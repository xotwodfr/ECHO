import Foundation
import Security
import Synchronization

/// Where the device token is kept between launches.
protocol TokenStorage: Sendable {
    /// The saved token, nil when there is none. Throws `TokenStoreError.locked` while the device is
    /// locked and the Keychain keeps its items closed (the app launched in the background).
    func load() throws -> String?
    func save(_ token: String) throws
    func delete()
}

enum TokenStoreError: Error, Equatable {
    case locked
    case keychain(OSStatus)
}

/// The device token in the Keychain as this device's alone (SETTINGS_AND_SECURITY.md §4.6): readable
/// only while the device is unlocked, never synced to iCloud Keychain nor restored to another device
/// (kSecAttrAccessibleWhenUnlockedThisDeviceOnly, not synchronizable). One per server.
///
/// The Mac uses the same data-protection Keychain as the iPhone. A build without a signing team
/// (the CI's, or Xcode's "Sign to Run Locally") is refused it (errSecMissingEntitlement) and falls
/// back to the login keychain, which never leaves the Mac either.
struct KeychainTokenStore: TokenStorage {
    static let defaultService = "com.folk3s.echo.device-token"

    /// The server the token is for ("https://echo.folk3s.com").
    var account: String
    var service = KeychainTokenStore.defaultService
    /// On the Mac: the login keychain when the data-protection one is refused.
    var fileKeychainFallback = true

    /// The data-protection Keychain first; on the Mac, the login keychain after it.
    private var keychains: [Bool] {
        #if os(macOS)
        fileKeychainFallback ? [true, false] : [true]
        #else
        [true]
        #endif
    }

    func query(dataProtection: Bool = true) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        #if os(macOS)
        if dataProtection { q[kSecUseDataProtectionKeychain as String] = true }
        #endif
        return q
    }

    /// What a token is added with: this device only, while unlocked, never synced.
    func addQuery(_ token: String, dataProtection: Bool = true) -> [String: Any] {
        var q = query(dataProtection: dataProtection)
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrSynchronizable as String] = false
        // The login keychain has no accessibility classes (and never syncs).
        if dataProtection { q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly }
        return q
    }

    func load() throws -> String? {
        for dataProtection in keychains {
            var q = query(dataProtection: dataProtection)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: AnyObject?
            let status = SecItemCopyMatching(q as CFDictionary, &out)
            switch status {
            case errSecSuccess:
                guard let data = out as? Data, let token = String(data: data, encoding: .utf8) else { return nil }
                return token
            case errSecItemNotFound, errSecMissingEntitlement:
                continue
            case errSecInteractionNotAllowed:
                throw TokenStoreError.locked
            default:
                throw TokenStoreError.keychain(status)
            }
        }
        return nil
    }

    func save(_ token: String) throws {
        delete()
        var status = errSecMissingEntitlement
        for dataProtection in keychains where status == errSecMissingEntitlement {
            status = SecItemAdd(addQuery(token, dataProtection: dataProtection) as CFDictionary, nil)
        }
        if status == errSecInteractionNotAllowed { throw TokenStoreError.locked }
        guard status == errSecSuccess else { throw TokenStoreError.keychain(status) }
    }

    func delete() {
        for dataProtection in keychains {
            SecItemDelete(query(dataProtection: dataProtection) as CFDictionary)
        }
    }

    /// Whether the data-protection Keychain works here (a test host without entitlements has none).
    static func dataProtectionKeychainWorks() -> Bool {
        let probe = KeychainTokenStore(
            account: "probe-\(UUID().uuidString)", service: defaultService + ".probe", fileKeychainFallback: false)
        let status = SecItemAdd(probe.addQuery("probe") as CFDictionary, nil)
        probe.delete()
        return status == errSecSuccess
    }
}

/// A token kept in memory only: the preview, and tests.
final class MemoryTokenStore: TokenStorage {
    private let box: Mutex<String?>

    init(_ token: String? = nil) {
        box = Mutex(token)
    }

    func load() throws -> String? { box.withLock { $0 } }
    func save(_ token: String) throws { box.withLock { $0 = token } }
    func delete() { box.withLock { $0 = nil } }
}
