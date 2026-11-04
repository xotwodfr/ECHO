import Foundation
import Security

/// The device token in the Keychain, as this device's alone: never synced to iCloud or restored to
/// another device (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly), one per server.
enum TokenStore {
    private static let service = "com.folk3s.echo.device-token"

    private static func query(_ server: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: server]
    }

    static func load(server: String) -> String? {
        var q = query(server)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String, server: String) {
        forget(server: server)
        var q = query(server)
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func forget(server: String) {
        SecItemDelete(query(server) as CFDictionary)
    }
}
