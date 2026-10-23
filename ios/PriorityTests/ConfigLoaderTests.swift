import XCTest
@testable import Priority

final class ConfigLoaderTests: XCTestCase {
    private let realConfig: [String: Any] = [
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_real",
        "API_BASE_URL": "https://priority.example.com",
    ]

    func testCompleteConfigHasNoProblem() {
        XCTAssertNil(ConfigLoader.problem(realConfig))
        XCTAssertTrue(ConfigLoader.missingKeys(realConfig).isEmpty)
    }

    func testMissingKeysListsEveryAbsentKey() {
        let info: [String: Any] = ["SUPABASE_URL": "https://example.supabase.co"]
        XCTAssertFalse(ConfigLoader.missingKeys(info).isEmpty)
        XCTAssertEqual(ConfigLoader.missingKeys([:]).count, 3)
    }

    func testPlaceholderAndMalformedURLsCountAsMissing() {
        var info = realConfig
        info["SUPABASE_URL"] = "https://YOUR-PROJECT.supabase.co"
        XCTAssertFalse(ConfigLoader.missingKeys(info).isEmpty)
        info["SUPABASE_URL"] = "https://example.supabase.co"
        info["API_BASE_URL"] = "not a url"
        XCTAssertFalse(ConfigLoader.missingKeys(info).isEmpty)
    }
}
