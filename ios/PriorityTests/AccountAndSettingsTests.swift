import XCTest
@testable import Priority

@MainActor
final class AccountModelTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-11-25T15:00:00Z")!

    func testShowsEmailAndLastSynced() async {
        let api = APIFake()
        api.set("GET api/auth/me", #"{"id":"u1","email":"student@example.edu"}"#)
        api.set("GET api/canvas/sync", #"{"lastSyncedAt":"2026-11-25T14:55:00.000Z"}"#)
        let model = AccountModel(api: api)
        await model.load(now: now)
        XCTAssertEqual(model.email, .loaded("student@example.edu"))
        XCTAssertEqual(model.lastSynced, .loaded("5 minutes ago"))
    }

    func testOfflineThenRecoversThenKeepsWhatItHad() async {
        let api = APIFake()
        let model = AccountModel(api: api)
        await model.load(now: now)
        XCTAssertEqual(model.email, .unavailable)
        XCTAssertEqual(model.lastSynced, .unavailable)

        api.set("GET api/auth/me", #"{"id":"u1","email":"student@example.edu"}"#)
        api.set("GET api/canvas/sync", #"{"lastSyncedAt":null}"#)
        await model.load(now: now)
        XCTAssertEqual(model.lastSynced, .loaded("Never synced"))

        api.answers = [:]
        await model.load(now: now)
        XCTAssertEqual(model.email, .loaded("student@example.edu"))
        XCTAssertEqual(model.lastSynced, .loaded("Never synced"))
    }

    func testLastSyncedWording() {
        func text(_ secondsAgo: TimeInterval) -> String {
            AccountFormat.lastSynced(ISO8601DateFormatter().string(from: now.addingTimeInterval(-secondsAgo)), now: now)
        }
        XCTAssertEqual(text(30), "Just now")
        XCTAssertEqual(text(60), "1 minute ago")
        XCTAssertEqual(text(2 * 3_600), "2 hours ago")
        XCTAssertTrue(text(3 * 86_400).hasPrefix("Nov 22, "))
        XCTAssertEqual(AccountFormat.lastSynced("not a date"), "Never synced")
    }

    // The token is gone and the log-in screen is up before Supabase answers.
    func testLogOutClearsTheTokenWithoutWaitingForTheNetwork() async {
        let store = StoreFake()
        store.seed(AuthSession(accessToken: "at", refreshToken: "rt", accessTokenExpiresAt: Date().addingTimeInterval(3_600)))
        let fetcher = SlowRevokeFetcher()
        let model = AuthModel(
            config: testAppConfig, tokenStore: store, urlSession: TestTransport.urlSession(),
            defaults: freshTestDefaults(), authFetcher: fetcher
        )
        model.restoreSession()
        XCTAssertEqual(model.state, .signedIn)
        let signOut = Task { await model.signOut() }
        let revoking = await waitUntilMainActor { fetcher.revoked == "at" }
        XCTAssertTrue(revoking)
        XCTAssertNil(store.readSession())
        XCTAssertEqual(model.state, .signedOut)
        fetcher.release()
        await signOut.value
    }
}

private final class SlowRevokeFetcher: AuthFetching, @unchecked Sendable {
    private let lock = NSLock()
    private var waiter: CheckedContinuation<Void, Never>?
    private var token: String?

    var revoked: String? {
        lock.lock()
        defer { lock.unlock() }
        return token
    }

    func signIn(email: String, password: String) async -> Result<AuthSession, AuthFailure> { .failure(.unavailable) }
    func withRefreshToken(_ refreshToken: String) async -> Result<AuthSession, AuthFailure> { .failure(.unavailable) }

    func revoke(_ session: AuthSession) async {
        await withCheckedContinuation { continuation in
            lock.lock()
            waiter = continuation
            token = session.accessToken
            lock.unlock()
        }
    }

    func release() {
        lock.lock()
        let pending = waiter
        waiter = nil
        lock.unlock()
        pending?.resume()
    }
}

@MainActor
final class NotificationSettingsModelTests: XCTestCase {
    private let getKey = "GET api/notifications/preferences"
    private let patchKey = "PATCH api/notifications/preferences"
    private let stored = #"{"notifyTonight":true,"notifyGradePosted":false,"notifyDueTomorrow":false,"nightlyReminderTime":"19:30"}"#

    private func loaded(_ api: APIFake) async -> NotificationSettingsModel {
        api.set(getKey, stored)
        let model = NotificationSettingsModel(api: api)
        await model.load()
        return model
    }

    func testLoadsTheThreeTogglesAndTheTime() async {
        let model = await loaded(APIFake())
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.values, NotificationPreferences(
            notifyTonight: true, notifyDueTomorrow: false, notifyGradePosted: false, nightlyReminderTime: "19:30"
        ))
        XCTAssertTrue(model.canEditTime)
    }

    func testAToggleSavesOnlyWhatChanged() async {
        let api = APIFake()
        let model = await loaded(api)
        api.set(patchKey, "{}")
        model.update { $0.notifyGradePosted = true }
        await model.saving?.value
        XCTAssertEqual(api.bodies as NSArray, [["notifyGradePosted": true]] as NSArray)
        XCTAssertNil(model.notice)
    }

    func testTimeSavesAsAZeroPaddedClockReading() async {
        let api = APIFake()
        let model = await loaded(api)
        api.set(patchKey, "{}")
        let date = ReminderTime.calendar.date(from: DateComponents(year: 2026, month: 1, day: 15, hour: 7, minute: 5))!
        model.update { $0.nightlyReminderTime = ReminderTime.string(from: date) }
        await model.saving?.value
        XCTAssertEqual(api.bodies as NSArray, [["nightlyReminderTime": "07:05"]] as NSArray)
    }

    // Changes made during a save go out together in the next one, in order.
    func testChangesDuringASaveGoOutNext() async {
        let api = APIFake()
        let model = await loaded(api)
        api.set(patchKey, "{}")
        api.holdPatch = true
        model.update { $0.notifyGradePosted = true }
        await settle()
        model.update { $0.notifyDueTomorrow = true }
        model.update { $0.notifyTonight = false }
        let task = model.saving
        api.release()
        await task?.value
        XCTAssertEqual(api.bodies as NSArray, [
            ["notifyGradePosted": true],
            ["notifyDueTomorrow": true, "notifyTonight": false],
        ] as NSArray)
        XCTAssertNil(model.saving)
    }

    func testAFailedSavePutsTheChangeBack() async {
        let api = APIFake()
        let model = await loaded(api)
        api.answers[patchKey] = [.offline]
        model.update { $0.notifyTonight = false }
        await model.saving?.value
        XCTAssertTrue(model.values.notifyTonight)
        XCTAssertEqual(model.notice, NotificationSettingsModel.saveOffline)
    }

    func testTimeIsLockedWhenBothNightlyRemindersAreOff() async {
        let api = APIFake()
        let model = await loaded(api)
        api.set(patchKey, "{}")
        model.update { $0.notifyTonight = false }
        XCTAssertFalse(model.canEditTime)
        await model.saving?.value
    }

    func testReminderTimeRoundTrips() {
        for value in ["00:00", "07:05", "19:30", "23:59"] {
            XCTAssertEqual(ReminderTime.date(from: value).map(ReminderTime.string), value)
        }
        XCTAssertNil(ReminderTime.date(from: "24:00"))
        XCTAssertNil(ReminderTime.date(from: "soon"))
    }
}
