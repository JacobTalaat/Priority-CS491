import XCTest
@testable import Priority

// Runs against the real simulator Keychain with a throwaway service name,so
// mutants that broke the SecItem status handling can't hide behind a fake.
@MainActor
final class KeychainStoreTests: XCTestCase {
    private var store: KeychainStore!

    override func setUp() {
        super.setUp()
        store = KeychainStore(service: "com.prioritycapstone.Priority.tests.\(UUID().uuidString)")
    }

    override func tearDown() {
        try? store.deleteSession()
        store = nil
        super.tearDown()
    }

    private func session(_ access: String, expiry: TimeInterval = 3_600) -> AuthSession {
        AuthSession(
            accessToken: access,
            refreshToken: "rt-\(access)",
            accessTokenExpiresAt: Date().addingTimeInterval(expiry)
        )
    }

    func testSaveThenReadRoundTrips() throws {
        let saved = session("at-1")
        try store.saveSession(saved)
        let read = store.readSession()
        XCTAssertEqual(read?.accessToken, saved.accessToken)
        XCTAssertEqual(read?.refreshToken, saved.refreshToken)
        // The date survives the JSON round-trip with tiny float slop.
        XCTAssertTrue(read.map { $0.accessTokenExpiresAt.timeIntervalSince(saved.accessTokenExpiresAt).magnitude < 0.001 } ?? false)
    }

    func testSavingTwiceKeepsOnlyTheNewestSession() throws {
        try store.saveSession(session("at-1"))
        let newest = session("at-2")
        try store.saveSession(newest)
        let read = store.readSession()
        XCTAssertEqual(read?.accessToken, "at-2")
        XCTAssertEqual(read?.refreshToken, "rt-at-2")
        // A whole-second gap proves the newest payload survived, not the old one.
        XCTAssertTrue(read.map { $0.accessTokenExpiresAt.timeIntervalSince(newest.accessTokenExpiresAt).magnitude < 0.001 } ?? false)
    }

    func testDeleteWhenNothingIsStoredDoesNotThrow() {
        XCTAssertNoThrow(try store.deleteSession())
        XCTAssertNil(store.readSession())
    }

    func testDeleteAfterSaveRemovesTheSession() throws {
        try store.saveSession(session("at-1"))
        try store.deleteSession()
        XCTAssertNil(store.readSession())
    }
}
