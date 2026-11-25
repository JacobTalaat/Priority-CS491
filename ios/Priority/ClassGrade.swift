import Foundation

// GET /api/canvas/courses
struct ClassListResponse: Decodable, Equatable {
    struct Course: Decodable, Equatable, Identifiable {
        let id: String
        let name: String
        let courseCode: String?
        let term: String?
    }

    let connected: Bool
    let courses: [Course]

    static func parse(_ data: Data) -> ClassListResponse? {
        try? JSONDecoder().decode(ClassListResponse.self, from: data)
    }
}

// GET /api/courses/{id}/grade, the parts the app shows.
struct ClassGradeResponse: Decodable, Equatable {
    struct Course: Decodable, Equatable {
        let id: String
        let name: String
        let courseCode: String?
        let term: String?
    }

    struct Category: Decodable, Equatable {
        let category: String
        let weight: Double
        let percentage: Double?
        let pointsEarned: Double
        let pointsPossible: Double
        let gradedCount: Int
        let ungradedCount: Int
    }

    let course: Course
    let setupConfirmed: Bool
    let engine: String
    let letter: String?
    let grade: ClassGrade
    let breakdown: [Category]

    static func parse(_ data: Data) -> ClassGradeResponse? {
        try? JSONDecoder().decode(ClassGradeResponse.self, from: data)
    }
}

enum ClassGrade: Decodable, Equatable {
    case calculated(Double)
    case insufficientData
    case unsupported(reason: String?)

    private enum Keys: String, CodingKey { case status, percentage, reason }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        let status = try container.decode(String.self, forKey: .status)
        switch status {
        case "calculated":
            self = .calculated(try container.decode(Double.self, forKey: .percentage))
        case "insufficient-data":
            self = .insufficientData
        case "unsupported":
            self = .unsupported(reason: try container.decodeIfPresent(String.self, forKey: .reason))
        default:
            throw DecodingError.dataCorruptedError(forKey: .status, in: container, debugDescription: "Unknown grade status")
        }
    }
}

// The same wording the website builds in src/lib/class-page.ts.
enum ClassFormat {
    private static func number(_ value: Double, maxDigits: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.roundingMode = .halfUp
        formatter.maximumFractionDigits = maxDigits
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    static func percent(_ value: Double) -> String {
        "\(number(value, maxDigits: 1))%"
    }

    private static func points(_ value: Double) -> String {
        number(value, maxDigits: 2)
    }

    static func subtitle(code: String?, term: String?) -> String {
        let parts = [code, term].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? "Imported from Canvas" : parts.joined(separator: " · ")
    }

    static func unsupportedDetail(_ reason: String?) -> String {
        switch reason {
        case "unsupported-rule":
            return "This class has a grading rule (like a dropped score, curve, or late penalty) that Priority can't grade yet."
        case "negative-score":
            return "A grade below zero is stored for this class."
        case "non-finite-result":
            return "The grade math didn't produce a usable number."
        default:
            return "This class uses a grading rule Priority can't calculate."
        }
    }

    static let noGradeDetail = "Nothing in this class is graded enough to work out a grade."

    // "81% · 81 of 100 points · 2 graded, 1 to go"
    static func categoryLine(_ category: ClassGradeResponse.Category) -> String {
        let counts = category.ungradedCount > 0
            ? "\(category.gradedCount) graded, \(category.ungradedCount) to go"
            : "\(category.gradedCount) graded"
        guard let percentage = category.percentage else {
            if category.pointsEarned > 0 {
                return "\(points(category.pointsEarned)) bonus points · \(counts)"
            }
            return category.ungradedCount > 0
                ? "Nothing graded yet · \(category.ungradedCount) to go"
                : "No assignments in this category"
        }
        return "\(percent(percentage)) · \(points(category.pointsEarned)) of \(points(category.pointsPossible)) points · \(counts)"
    }

    // The website's page for changing this class's weights.
    static func editURL(website: URL?, courseId: String) -> URL? {
        guard let website, var components = URLComponents(url: website, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/weights"
        // Encode everything but letters, digits and -._~, so an id can't add a
        // second query item ("+" and "&" included).
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        guard let id = courseId.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        components.percentEncodedQuery = "course=\(id)"
        components.fragment = nil
        return components.url
    }
}
