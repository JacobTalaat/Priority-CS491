import XCTest
@testable import Priority

final class AuthFailureMappingTests: XCTestCase {
    private func body(_ json: String) -> Data {
        Data(json.utf8)
    }

    func testMessageWordingIsExhaustive() {
        XCTAssertEqual(AuthErrors.message(for: .wrongCredentials), "Wrong email or password. Check them and try again.")
        XCTAssertEqual(AuthErrors.message(for: .emailNotConfirmed), "Confirm your email first. Check your inbox for the link.")
        XCTAssertEqual(AuthErrors.message(for: .unavailable), "Couldn't reach Priority. Check your connection.")
        XCTAssertEqual(AuthErrors.message(for: .storageFailed), "Couldn't save your sign-in on this iPhone. Try again.")
        XCTAssertFalse(AuthErrors.message(for: .rejection).isEmpty)
    }

    func testBranchesOnErrorCodeNotMessage() {
        XCTAssertEqual(AuthErrors.rejection(fromErrorCode: "invalid_credentials"), .wrongCredentials)
        XCTAssertEqual(AuthErrors.rejection(fromErrorCode: "email_not_confirmed"), .emailNotConfirmed)
        XCTAssertEqual(AuthErrors.rejection(fromErrorCode: "invalid_grant"), .rejection)
        XCTAssertEqual(AuthErrors.rejection(fromErrorCode: "opaque_other_code"), .rejection)
        XCTAssertEqual(AuthErrors.rejection(fromErrorCode: nil), .rejection)
    }

    func testInvalidCredentialsBodyMapsToWrongCredentials() {
        XCTAssertEqual(
            AuthErrors.failure(httpStatus: 400, body: body(#"{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}"#), wasNetworkError: false),
            .wrongCredentials
        )
        XCTAssertEqual(
            AuthErrors.failure(httpStatus: 400, body: body(#"{"code":400,"error_code":"email_not_confirmed","msg":"Email not confirmed"}"#), wasNetworkError: false),
            .emailNotConfirmed
        )
    }

    func testOutageStatusesAreNotAuthAnswers() {
        // Network failure always wins; only 400/401/422 are auth answers.
        XCTAssertEqual(
            AuthErrors.failure(httpStatus: 400, body: body(#"{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}"#), wasNetworkError: true),
            .unavailable
        )
        XCTAssertEqual(AuthErrors.failure(httpStatus: 503, body: nil, wasNetworkError: false), .unavailable)
        XCTAssertEqual(AuthErrors.failure(httpStatus: 404, body: nil, wasNetworkError: false), .unavailable)
        XCTAssertEqual(AuthErrors.failure(httpStatus: nil, body: nil, wasNetworkError: false), .unavailable)
    }
}
