import XCTest
@testable import Priority

final class URLBuildingTests: XCTestCase {
    private let supabase = URL(string: "https://example.supabase.co")!
    private let api = URL(string: "https://priority.example.com")!

    func testTokenGrantURLIncludesGrantTypeAndPasswordPath() {
        XCTAssertEqual(
            AuthClient.tokenGrantURL(supabaseBase: supabase, grantType: "password"),
            URL(string: "https://example.supabase.co/auth/v1/token?grant_type=password")
        )
        XCTAssertEqual(
            AuthClient.tokenGrantURL(supabaseBase: supabase, grantType: "refresh_token"),
            URL(string: "https://example.supabase.co/auth/v1/token?grant_type=refresh_token")
        )
    }

    func testLogoutURLRevokesOnlyThisDevice() {
        XCTAssertEqual(
            AuthClient.logoutURL(supabaseBase: supabase),
            URL(string: "https://example.supabase.co/auth/v1/logout?scope=local")
        )
    }

    func testParseMeAcceptsTheAPIShape() {
        let data = Data(#"{"id":"usr_1","email":"student@school.edu"}"#.utf8)
        XCTAssertEqual(APIClient.parseMe(data)?.id, "usr_1")
        XCTAssertEqual(APIClient.parseMe(data)?.email, "student@school.edu")
        XCTAssertNil(APIClient.parseMe(Data("{}".utf8)))
        XCTAssertNil(APIClient.parseMe(Data("nope".utf8)))
    }
}

extension URLBuildingTests {
    func testMeURL() {
        XCTAssertEqual(APIClient.meURL(apiBase: api), URL(string: "https://priority.example.com/api/auth/me"))
    }
}
