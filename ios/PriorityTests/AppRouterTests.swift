import XCTest
@testable import Priority

@MainActor
final class AppRouterTests: XCTestCase {
    func testTonightAndDueTomorrowOpenToday() {
        XCTAssertEqual(NotificationRoute.from(userInfo: ["kind": "tonight", "url": "/today"]), .today)
        XCTAssertEqual(NotificationRoute.from(userInfo: ["kind": "due-tomorrow", "url": "/today"]), .today)
    }

    func testGradePostedOpensItsClass() {
        XCTAssertEqual(
            NotificationRoute.from(userInfo: ["kind": "grade-posted", "url": "/classes/c42"]), .course("c42")
        )
    }

    // A notification sent before class links existed still opens Classes.
    func testGradePostedWithoutAClassOpensTheList() {
        XCTAssertEqual(NotificationRoute.from(userInfo: ["kind": "grade-posted", "url": "/classes"]), .classes)
        XCTAssertEqual(NotificationRoute.from(userInfo: ["kind": "grade-posted"]), .classes)
    }

    func testKindDecidesWhenTheUrlIsMissingOrUnknown() {
        XCTAssertEqual(NotificationRoute.from(userInfo: ["kind": "tonight"]), .today)
        XCTAssertEqual(NotificationRoute.from(userInfo: ["kind": "tonight", "url": "/somewhere"]), .today)
        XCTAssertNil(NotificationRoute.from(userInfo: [:]))
        XCTAssertNil(NotificationRoute.from(userInfo: ["kind": "other", "url": 7]))
    }

    func testOnlyTheAppsOwnPathsCount() {
        for path in ["https://evil.test/today", "//evil.test/today", "today", "", "/classes/a/b"] {
            XCTAssertNil(NotificationRoute.from(path: path), path)
        }
        XCTAssertEqual(NotificationRoute.from(path: "/classes/a%2Fb%20c"), .course("a/b c"))
        XCTAssertEqual(NotificationRoute.from(path: "/today?from=push"), .today)
    }

    func testOpeningAClassShowsItOnTheClassesTab() {
        let router = AppRouter()
        router.open(.course("c1"))
        XCTAssertEqual(router.tab, .classes)
        XCTAssertEqual(router.classPath.map(\.courseId), ["c1"])
    }

    // The same class again is a new page, so it loads the new grade.
    func testOpeningTheSameClassTwiceIsANewVisit() {
        let router = AppRouter()
        router.open(.course("c1"))
        let first = router.classPath
        router.open(.course("c1"))
        XCTAssertEqual(router.classPath.count, 1)
        XCTAssertNotEqual(router.classPath, first)
    }

    func testOpeningTodayReloadsIt() {
        let router = AppRouter()
        router.open(.course("c1"))
        router.open(.today)
        XCTAssertEqual(router.tab, .today)
        XCTAssertEqual(router.todayVisit, 1)
    }

    func testResetForgetsTheOpenPage() {
        let router = AppRouter()
        router.open(.course("c1"))
        router.reset()
        XCTAssertEqual(router.tab, .today)
        XCTAssertTrue(router.classPath.isEmpty)
    }
}
