import SwiftUI

@main
struct PriorityApp: App {
    // Session state lives here so the Keychain restore and screen switches
    // happen in exactly one place.
    @StateObject private var model = AuthModel()

    var body: some Scene {
        WindowGroup {
            Group {
                switch model.state {
                case .restoring:
                    // Keep the screen blank for a beat while the Keychain is
                    // checked, so a signed-out flash doesn't flicker in.
                    ZStack {
                        Color.black.ignoresSafeArea()
                        ProgressView().tint(.white)
                    }
                case .signedOut:
                    LogInView(model: model)
                case .signedIn:
                    ContentView(model: model)
                }
            }
            .task { model.restoreSession() }
        }
    }
}
