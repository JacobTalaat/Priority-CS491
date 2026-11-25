import SwiftUI

// The one call the Classes, Account and Notifications screens need. AuthModel
// is the real one; tests answer it directly.
@MainActor
protocol APIRequesting {
    func request(_ method: String, _ segments: [String], json: Data?, headers: [String: String]) async -> APIResponse
}

extension AuthModel: APIRequesting {}

extension APIRequesting {
    func get(_ segments: [String]) async -> APIResponse {
        await request("GET", segments, json: nil, headers: [:])
    }
}

// What fills a screen when there is nothing to show.
struct ScreenProblem: Equatable {
    let title: String
    let message: String
    var offline = false

    static let serverTrouble = "Something went wrong on our side. Try again in a minute."

    // Nil for a signed-out answer: AuthModel has already switched to log in.
    static func from(_ response: APIResponse, title: String) -> ScreenProblem? {
        switch response {
        case .signedOut:
            return nil
        case .offline:
            return ScreenProblem(title: TodayMessages.offlineTitle, message: TodayMessages.offline, offline: true)
        case .failed(_, let message):
            return ScreenProblem(title: title, message: message ?? serverTrouble)
        case .ok:
            // A 200 the app couldn't read.
            return ScreenProblem(title: title, message: serverTrouble)
        }
    }
}

struct ProblemView: View {
    let problem: ScreenProblem
    let retry: () async -> Void

    var body: some View {
        ContentUnavailableView {
            Label(problem.title, systemImage: problem.offline ? "wifi.slash" : "exclamationmark.triangle")
        } description: {
            Text(problem.message)
        } actions: {
            Button("Try again") { Task { await retry() } }
                .buttonStyle(.borderedProminent)
        }
    }
}

// A message above content that is still on screen.
struct NoticeText: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(TodayView.warning)
            Text(text)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
