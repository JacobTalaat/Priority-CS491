import XCTest
@testable import Priority

// Covers the shared-refresh lifecycle rules beyond a single refresh call.
@MainActor
final class SharedRefreshTests: XCTestCase {
    override func setUp() {
        super.setUp()
        PolicyURLProtocol.reset()
    }

    private func nearExpired(_ refresh: String) -> AuthSession {
        AuthSession(
            accessToken: "at-\(refresh)",
            refreshToken: refresh,
            accessTokenExpiresAt: Date().addingTimeInterval(-1)
        )
    }

    private func makeModel(store: StoreFake, fetcher: AuthFetcherFake) -> AuthModel {
        AuthModel(
            config: testAppConfig,
            tokenStore: store,
            urlSession: TestTransport.urlSession(),
            defaults: freshTestDefaults(),
            authFetcher: fetcher
        )
    }

    // Two concurrent stale-session callers share one refresh and both get the
    // same refreshed session.
    func testConcurrentStaleCallersShareOneRefreshAndSession() async {
        let store = StoreFake()
        store.seed(nearExpired("rt-old"))
        let fetcher = AuthFetcherFake()
        fetcher.blockNextRefresh()
        let model = makeModel(store: store, fetcher: fetcher)
        PolicyURLProtocol.set(200, forPath: mePath, json: #"{"id":"u1","email":"student@school.edu"}"#)

        async let first = model.confirmAccount()
        async let second = model.confirmAccount()
        await waitUntilMainActor { fetcher.refreshStartedCount == 1 }
        try? await Task.sleep(nanoseconds: 50_000_000)
        fetcher.releaseAllWaiters()
        let (one, two) = await (first, second)

        XCTAssertEqual(one, .confirmed)
        XCTAssertEqual(two, .confirmed)
        XCTAssertEqual(fetcher.refreshStartedCount, 1)
        XCTAssertEqual(store.readSession()?.refreshToken, "rt-fresh")
        XCTAssertEqual(store.readSession()?.accessToken, "at-fresh")
    }

    // Once a refresh is done, the in-flight task must not be reused: a later
    // expiry triggers a genuinely new refresh.
    func testFinishedRefreshTaskIsClearedForLaterExpiry() async {
        let store = StoreFake()
        store.seed(nearExpired("rt-old"))
        let fetcher = AuthFetcherFake()
        let model = makeModel(store: store, fetcher: fetcher)
        PolicyURLProtocol.set(200, forPath: mePath, json: #"{"id":"u1","email":"student@school.edu"}"#)

        let check = await model.confirmAccount()
        XCTAssertEqual(check, .confirmed)
        XCTAssertEqual(fetcher.refreshStartedCount, 1)
        XCTAssertEqual(store.readSession()?.refreshToken, "rt-fresh")

        // The access token from the first refresh is now stale again.
        store.seed(nearExpired("rt-fresh"))
        fetcher.setNext(isRefreshResult: .success(
            AuthSession(accessToken: "at-fresh2", refreshToken: "rt-fresh2", accessTokenExpiresAt: Date().addingTimeInterval(3_600))
        ))
        let check2 = await model.confirmAccount()
        XCTAssertEqual(check2, .confirmed)
        XCTAssertEqual(fetcher.refreshStartedCount, 2)
        XCTAssertEqual(store.readSession()?.refreshToken, "rt-fresh2")
    }

    // If saving the refreshed session fails, the fresh (live) tokens stay in
    // memory and the UI is told at once, but the student is not signed out.
    func testRefreshPersistFailureKeepsFreshSessionInMemory() async {
        let store = StoreFake()
        store.seed(nearExpired("rt-old"))
        store.failSave = true
        let fetcher = AuthFetcherFake()
        let model = makeModel(store: store, fetcher: fetcher)
        PolicyURLProtocol.set(200, forPath: mePath, json: #"{"id":"u1","email":"student@school.edu"}"#)

        let check = await model.confirmAccount()

        XCTAssertEqual(check, .confirmed)
        XCTAssertEqual(model.state, .restoring) // untouched, not signed out
        XCTAssertEqual(model.errorText, AuthErrors.storageFailedMessage)
        // The Keychain still holds the (now dead) old session; the fresh one
        // lives only in memory for this run.
        XCTAssertEqual(store.readSession()?.refreshToken, "rt-old")

        // The next request comes from the in-memory session: still only ONE
        // refresh total, even though the Keychain holds the dead old tokens.
        // A different answer for any sneaky second refresh would catch that.
        fetcher.setNext(isRefreshResult: .success(
            AuthSession(accessToken: "at-fresh2", refreshToken: "rt-fresh2", accessTokenExpiresAt: Date().addingTimeInterval(3_600))
        ))
        PolicyURLProtocol.reset()
        PolicyURLProtocol.set(200, forPath: mePath, json: #"{"id":"u1","email":"second@school.edu"}"#)
        let after = await model.confirmAccount()
        XCTAssertEqual(after, .confirmed)
        XCTAssertEqual(PolicyURLProtocol.calls(toPath: mePath), 1)
        XCTAssertEqual(fetcher.refreshStartedCount, 1)
        // The Authorization header carried the fresh access token from memory.
        XCTAssertEqual(PolicyURLProtocol.bearersOfCalls(toPath: mePath).first, "Bearer at-fresh")
        XCTAssertEqual(store.readSession()?.refreshToken, "rt-old")
    }
}
