import Foundation
import Security

// A done-able abstraction so tests can inject Keychain failures.
protocol TokenStoring {
    func readSession() -> AuthSession?
    func saveSession(_ session: AuthSession) throws
    func deleteSession() throws
}

enum KeychainError: Error {
    case saveFailed(OSStatus)
    case deleteFailed(OSStatus)
}

// Criterion 2: tokens are secrets, so they live on-device in the Keychain,
// never UserDefaults and never in logs. The whole session is one generic
// password item (JSON payload), so replacing it is atomic: a save can never
// leave half of the old session next to half of the new one.
struct KeychainStore: TokenStoring {
    static let service = "com.prioritycapstone.Priority"

    private let service: String

    // service is injectable so tests can use a throwaway name in the real
    // simulator Keychain without touching the app's own item.
    init(service: String = Self.service) {
        self.service = service
    }

    private func baseQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: "supabase_session",
        ]
    }

    func readSession() -> AuthSession? {
        var request = baseQuery()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        // errSecItemNotFound (and anything else) just means there is no
        // usable session; reading failures are not secrets.
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return AuthSession.decode(data)
    }

    func saveSession(_ session: AuthSession) throws {
        // SecItemUpdate would need the item to exist, so delete-then-add. The
        // item holds the full session, making the swap a single operation.
        let existing = baseQuery()
        var attributes = existing
        attributes[kSecValueData as String] = AuthSession.encode(session)
        // kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly: readable once the
        // phone is unlocked, never synced to other devices or iCloud backups
        // joined later.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemDelete(existing as CFDictionary)
        // Only errSecSuccess is a real save; SecItemAdd never legitimately
        // returns errSecItemNotFound, and accepting it could hide a failed
        // save from the student.
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.saveFailed(status) }
    }

    func deleteSession() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        // Deleting something already gone is exactly the outcome sign-out wants.
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.deleteFailed(status)
        }
    }
}
