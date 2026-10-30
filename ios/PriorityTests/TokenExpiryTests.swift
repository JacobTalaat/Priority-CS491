import XCTest
@testable import Priority

final class TokenExpiryTests: XCTestCase {
    func testExpiringWithinWindowIsNearExpiry() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertTrue(TokenExpiry.isNearExpiry(expiresAt: now.addingTimeInterval(59), at: now))
        XCTAssertTrue(TokenExpiry.isNearExpiry(expiresAt: now, at: now))
        XCTAssertTrue(TokenExpiry.isNearExpiry(expiresAt: now.addingTimeInterval(-10), at: now))
    }

    func testTokenOutsideWindowIsFresh() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertFalse(TokenExpiry.isNearExpiry(expiresAt: now.addingTimeInterval(61), at: now))
        XCTAssertFalse(TokenExpiry.isNearExpiry(expiresAt: now.addingTimeInterval(3_600), at: now))
    }
}

final class TokenResponseParsingTests: XCTestCase {
    func testParseFullTokenResponse() {
        let data = Data(#"{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600,"token_type":"bearer","user":{"id":"u1"}}"#.utf8)
        let parsed = TokenResponse.parse(data)
        XCTAssertEqual(parsed?.accessToken, "at-1")
        XCTAssertEqual(parsed?.refreshToken, "rt-1")
        XCTAssertEqual(parsed?.expiresIn, 3600)
    }

    func testMissingOrEmptyFieldsAreRejected() {
        XCTAssertNil(TokenResponse.parse(Data(#"{"access_token":"at-1","refresh_token":"rt-1"}"#.utf8)))
        XCTAssertNil(TokenResponse.parse(Data(#"{"access_token":"","refresh_token":"rt-1","expires_in":60}"#.utf8)))
        XCTAssertNil(TokenResponse.parse(Data("not json".utf8)))
    }

    func testZeroExpiresInIsRejected() {
        // expires_in 0 would mean the token is already expired; reject it so
        // the student gets a real sign-in error instead of a dead session.
        XCTAssertNil(TokenResponse.parse(Data(#"{"access_token":"at-1","refresh_token":"rt-1","expires_in":0}"#.utf8)))
    }

    func testSessionExpiresAtIsReceivedAtPlusExpiresIn() {
        let receivedAt = Date(timeIntervalSince1970: 1_000_000)
        let session = AuthSession.from(
            TokenResponse(accessToken: "at-1", refreshToken: "rt-1", expiresIn: 3600),
            receivedAt: receivedAt
        )
        XCTAssertEqual(session.accessTokenExpiresAt.timeIntervalSince(receivedAt), 3_600, accuracy: 0.001)
    }
}
