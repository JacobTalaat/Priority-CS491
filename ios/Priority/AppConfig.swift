import Foundation

// The app reads its three configuration values from Info.plist keys so nobody
// has to edit Swift code to point the app at a different Supabase project or
// API deployment. Values come from Config.xcconfig (placeholders) or each
// developer overrides them without committing real keys.
enum AppConfigKey: String, CaseIterable {
    case supabaseURL = "SUPABASE_URL"
    case supabasePublishableKey = "SUPABASE_PUBLISHABLE_KEY"
    case apiBaseURL = "API_BASE_URL"
}

struct AppConfig {
    let supabaseURL: URL
    let supabasePublishableKey: String
    let apiBaseURL: URL
}

struct ConfigProblem: Equatable {
    let missingKeys: [AppConfigKey]

    var message: String {
        let names = missingKeys.map(\.rawValue).joined(separator: ", ")
        return "Priority isn't set up on this device. Missing keys: \(names). See ios/Config.xcconfig in the repo."
    }
}

enum ConfigLoader {
    // Placeholder values committed in Config.xcconfig must not be mistaken
    // for a real hostname, or the app would silently point at nothing.
    private static func isPlaceholder(_ value: String) -> Bool {
        let lowered = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return lowered.contains("REPLACE_WITH") || lowered.contains("YOUR-")
    }

    static func missingKeys(_ info: [String: Any]) -> [AppConfigKey] {
        AppConfigKey.allCases.filter { key in
            guard let value = (info[key.rawValue] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty,
                  !isPlaceholder(value) else { return true }
            if key == .supabasePublishableKey { return false }
            return URL(string: value)?.host != nil ? false : true
        }
    }

    static func problem(_ info: [String: Any]) -> ConfigProblem? {
        let missing = missingKeys(info)
        return missing.isEmpty ? nil : ConfigProblem(missingKeys: missing)
    }

    static func load(bundle: Bundle = .main) -> AppConfig? {
        guard let info = bundle.infoDictionary,
              problem(info) == nil,
              let supabaseURL = URL(string: info[AppConfigKey.supabaseURL.rawValue] as? String ?? ""),
              let apiBaseURL = URL(string: info[AppConfigKey.apiBaseURL.rawValue] as? String ?? ""),
              let key = info[AppConfigKey.supabasePublishableKey.rawValue] as? String else { return nil }
        return AppConfig(supabaseURL: supabaseURL, supabasePublishableKey: key, apiBaseURL: apiBaseURL)
    }
}
