# Priority iOS app

SwiftUI app for iPhone, iOS 17 and later. Bundle id: `com.prioritycapstone.Priority`.

The project uses Xcode's folder-synced groups, so any `.swift` file you add under `ios/Priority/` is picked up automatically. No project file edits are needed.

## Run in the Simulator

1. Open `ios/Priority.xcodeproj` in Xcode 16 or later.
2. Pick the **Priority** scheme and any iPhone simulator.
3. Press **Run** (⌘R).

From the command line:

```bash
xcodebuild -project ios/Priority.xcodeproj -scheme Priority -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
```

## Run on your iPhone

1. Plug in the iPhone and tap **Trust** on the phone.
2. On the phone, turn on **Settings → Privacy & Security → Developer Mode** and restart when asked.
3. In Xcode, select the **Priority** target → **Signing & Capabilities** → **Team** and pick your Apple ID. A free Personal Team works for your own phone.
4. Pick your iPhone as the run destination and press **Run**.
5. The first time, the phone may block the app. Open **Settings → General → VPN & Device Management**, trust your developer certificate, then run again.

Don't commit your Team selection. `DEVELOPMENT_TEAM` is left blank on purpose so each person signs with their own account until the team's Apple Developer account is approved (PR-025).
