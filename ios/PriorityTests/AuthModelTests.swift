import XCTest
@testable import Priority

@MainActor
final class AuthModelTests: XCTestCase {
    override func setUp() {
        super.setUp()
        PolicyURLProtocol.reset()
    }

    private func session(access: String = "at-old", refresh: String = "rt-old", expiresIn: TimeInterval = 3_600) -> AuthSession {
        AuthSession(
            accessToken: access,
            refreshToken: refresh,
            accessTokenExpiresAt: Date().addingTimeInterval(expiresIn)
        )
    }

    private func makeModel(store: StoreFake, config: AppConfig = testAppConfig, defaults: UserDefaults = freshTestDefaults()) -> AuthModel {
        AuthModel(config: config, tokenStore: store, urlSession: TestTransport.urlSession(), defaults: defaults)
    }

    // 1. A Keychain save failure surfaces as a sign-in failure and the UI
    // stays on the log-in screen.
    func testKeychainSaveFailureKeepsSignOutState() async {
        let store = StoreFake()
        store.failSave = true
        PolicyURLProtocol.setTokenResponse(200, access: "at-new", refresh: "rt-new", expiresIn: 3_600, forPath: tokenGrantPath)
        let model = makeModel(store: store)
        model.email = "student@school.edu"
        model.password = "correct-horse"
        await model.signIn()
        XCTAssertEqual(model.state, .signedOut)
        XCTAssertEqual(model.errorText, AuthErrors.storageFailedMessage)
        XCTAssertNil(store.readSession())
    }

    // 2. A delete failure still returns to the log-in screen, and the next
    // launch retries the delete.
    func testDeleteFailureStillReturnsToLogInAndRetriesNextLaunch() async throws {
        let store = StoreFake()
        store.seed(session())
        let defaults = freshTestDefaults()
        let model = makeModel(store: store, defaults: defaults)
        model.restoreSession()
        XCTAssertEqual(model.state, .signedIn)
        store.failDelete = true
        PolicyURLProtocol.setNetworkFailure(forPath: tokenLogoutPath)
        await model.signOut()
        XCTAssertEqual(model.state, .signedOut)
        XCTAssertEqual(model.errorText, AuthErrors.signOutStorageMessage)
        XCTAssertNotNil(store.readSession())
        XCTAssertTrue(defaults.bool(forKey: "priority.pendingSignOutDelete"))

        store.failDelete = false
        PolicyURLProtocol.reset()
        let relaunched = makeModel(store: store, defaults: defaults)
        relaunched.restoreSession()
        XCTAssertEqual(relaunched.state, .signedOut)
        XCTAssertFalse(defaults.bool(forKey: "priority.pendingSignOutDelete"))
        XCTAssertNil(store.readSession())
    }

    // 3. A refresh that lands after a sign-out is discarded.
    func testRefreshResultIsDiscardedAfterSignOut() async {
        let store = StoreFake()
        store.seed(session(expiresIn: -1)) // stale, so requests want a refresh
        let fetcher = AuthFetcherFake()
        fetcher.blockNextRefresh()
        let model = AuthModel(config: testAppConfig, tokenStore: store, urlSession: TestTransport.urlSession(), defaults: freshTestDefaults(), authFetcher: fetcher)
        PolicyURLProtocol.set(401, forPath: mePath, json: "{}")

        let checking = Task { await model.confirmAccount() }
        await waitUntilMainActor { fetcher.refreshStartedCount == 1 }
        await model.signOut() // deletes the session while the refresh is in flight
        fetcher.releaseAllWaiters()
        let check = await checking.value

        XCTAssertEqual(check, .signedOut, "requests: \(PolicyURLProtocol.requests)")
        XCTAssertNil(store.readSession())
        XCTAssertEqual(model.state, .signedOut)
        XCTAssertGreaterThanOrEqual(fetcher.refreshStartedCount, 1)
    }

    // 4. 503/404/network errors are outages: the session is kept.
    func testOutageResponsesKeepTheSession() async {
        for status in [503, 404] {
            PolicyURLProtocol.reset()
            let store = StoreFake()
            store.seed(session())
            let model = makeModel(store: store)
            PolicyURLProtocol.set(status, forPath: mePath, json: "{}")
            let check = await model.confirmAccount()
            XCTAssertEqual(check, .unreachable)
            XCTAssertEqual(store.readSession()?.refreshToken, "rt-old", "status \(status)")
            XCTAssertEqual(PolicyURLProtocol.calls(toPath: tokenRefreshPath), 0, "status \(status)")
        }
        PolicyURLProtocol.reset()
        let store = StoreFake()
        store.seed(session())
        let model = makeModel(store: store)
        PolicyURLProtocol.setNetworkFailure(forPath: mePath)
        let check = await model.confirmAccount()
        XCTAssertEqual(check, .unreachable)
        XCTAssertEqual(store.readSession()?.refreshToken, "rt-old")
        XCTAssertEqual(PolicyURLProtocol.calls(toPath: tokenRefreshPath), 0)
    }

    // 5. A 401 triggers exactly one refresh, then the request is retried.
    func testUnauthorizedRefreshesOnceAndRetriesTheRequest() async {
        let store = StoreFake()
        store.seed(session())
        let model = makeModel(store: store)
        PolicyURLProtocol.setSequence(forPath: mePath, [(401, "{}"), (200, #"{"id":"u1","email":"student@school.edu"}"#)])
        PolicyURLProtocol.setTokenResponse(200, access: "at-fresh", refresh: "rt-fresh", expiresIn: 3_600, forPath: tokenRefreshPath)
        let check = await model.confirmAccount()
        XCTAssertEqual(check, .confirmed)
        XCTAssertEqual(PolicyURLProtocol.calls(toPath: tokenRefreshPath), 1)
        XCTAssertEqual(PolicyURLProtocol.calls(toPath: mePath), 2)
        XCTAssertEqual(store.readSession()?.refreshToken, "rt-fresh")
    }

    // 6. A refresh Supabase refuses, also during launch restoration, signs out.
    func testRestorationSignsOutWhenRefreshIsRefused() async {
        let store = StoreFake()
        store.seed(session(expiresIn: -1))
        let model = makeModel(store: store)
        PolicyURLProtocol.set(400, forPath: tokenRefreshPath, json: #"{"code":400,"error_code":"invalid_grant","msg":"Invalid Refresh Token"}"#)
        model.restoreSession()
        let signedOut = await waitUntilMainActor { model.state == .signedOut }
        XCTAssertTrue(signedOut)
        XCTAssertNil(store.readSession())
    }

    // 7. Two concurrent callers share one in-flight refresh.
    func testConcurrentCallersShareOneRefresh() async {
        let store = StoreFake()
        store.seed(session(expiresIn: -1))
        let fetcher = AuthFetcherFake()
        fetcher.blockNextRefresh()
        let model = AuthModel(config: testAppConfig, tokenStore: store, urlSession: TestTransport.urlSession(), defaults: freshTestDefaults(), authFetcher: fetcher)
        PolicyURLProtocol.set(200, forPath: mePath, json: #"{"id":"u1","email":"student@school.edu"}"#)

        async let first = model.confirmAccount()
        async let second = model.confirmAccount()
        await waitUntilMainActor { fetcher.refreshStartedCount == 1 }
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(fetcher.refreshStartedCount, 1) // still only one in flight
        fetcher.releaseAllWaiters()
        let (one, two) = await (first, second)
        XCTAssertEqual(one, .confirmed)
        XCTAssertEqual(two, .confirmed)
        XCTAssertEqual(fetcher.refreshStartedCount, 1)
        XCTAssertEqual(store.readSession()?.refreshToken, "rt-fresh")
    }

    // Basic restore path: a usable session in the store means signed in.
    func testRestoreFromKeychainShowsSignedIn() async {
        let store = StoreFake()
        store.seed(session())
        let model = makeModel(store: store)
        model.restoreSession()
        XCTAssertEqual(model.state, .signedIn)
        XCTAssertNil(model.errorText)
    }
}
