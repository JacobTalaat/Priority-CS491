import SwiftUI

@main
struct PriorityApp: App {
    // Session state lives here so the Keychain restore and screen switches
    // happen in exactly one place.
    @StateObject private var model = AuthModel()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            Group {
                switch model.state {
                case .restoring:
                    // The Keychain check takes a frame, so this repeats the
                    // launch screen (the mark on the launch background, centred
                    // on the whole screen) instead of flashing a spinner.
                    ZStack {
                        Color("LaunchBackground")
                        Image("LaunchMark")
                    }
                    .ignoresSafeArea()
                case .signedOut:
                    LogInView(model: model)
                case .signedIn:
                    MainView(auth: model, router: appDelegate.router)
                }
            }
            .task { model.restoreSession() }
            .onChange(of: model.state) { before, after in
                if before == .signedIn, after == .signedOut { appDelegate.router.reset() }
            }
        }
    }
}
