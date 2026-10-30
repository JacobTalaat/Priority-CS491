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

## Configuration (PURITY-097 setup)

The app reads three Info.plist keys, which `ios/Info.plist` fills in from `ios/Config.xcconfig`:

| Info.plist key | Meaning |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL, e.g. `https://abcd.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key from Project Settings -> API keys |
| `API_BASE_URL` | Base URL of the deployed Priority website, e.g. `https://priority.example.com` |

The committed `ios/Config.xcconfig` holds placeholders only. For real values, copy the keys into
`ios/Config.local.xcconfig`, a file that is gitignored, so no real key is ever committed:

```text
SUPABASE_URL = https:/$()/abcdefgh.supabase.co
SUPABASE_PUBLISHABLE_KEY = sb_publishable_xxxxxxxxxxxx
API_BASE_URL = https:/$()/priority.example.com
```

`Config.xcconfig` ends with `#include? "Config.local.xcconfig"`, so the gitignored file overrides the
placeholders when it exists.

Because `//` starts a comment in .xcconfig files, a plain `https://...` value would be truncated. Write
URLs with the `$()` trick — `$()` expands to nothing and breaks up the double slash:
`https:/$()/abcdefgh.supabase.co` becomes `https://abcdefgh.supabase.co` in the app.

## Local development against an http:// API

App Transport Security blocks plain http by default. Two ways to point the app at a local API:

1. Preferred: use the deployed https `API_BASE_URL`.
2. Dark-mode-the-attempt-at-your-own-risk: the **Debug configuration only** gets an ATS exception
   (`NSAllowsLocalNetworking`) in `ios/Info-debug.plist` (wired as `INFOPLIST_FILE` for Debug), which
   allows http against `localhost` and local network addresses. The Release build still ships the
   plain `ios/Info.plist` with no exception.

## How signing in works

- Request: `POST {SUPABASE_URL}/auth/v1/token?grant_type=password`, headers `apikey` and
  `Content-Type: application/json`, body `{"email": ..., "password": ...}` (plain URLSession, no SDK).
- The app then calls `GET {API_BASE_URL}/api/auth/me` with `Authorization: Bearer <access_token>` to
  confirm the account, the same call the website makes, so it is the same account.
- When the access token is within 60 seconds of expiring, the app refreshes using
  `grant_type=refresh_token`. A 401 from the API triggers one refresh and one retry; failing that, the
  student is signed out.
- Sign out calls `POST {SUPABASE_URL}/auth/v1/logout?scope=local` with the bearer token — only this
  device's session is revoked, so the student stays signed in on the website — and clears local storage
  no matter what the network says.

The session is restored from the Keychain on every launch, so the student stays signed in across app
restarts. The 60-second expiry window is checked before **every** API request (not just launch), so a
stale token is refreshed on the spot. Concurrency is handled: all simultaneous requests share one
in-flight refresh, and a refresh result is persisted only if the session it refreshed is still the
current one — a refresh that lands after a sign-out is thrown away. A refresh Supabase refuses means
the stored session is dead, so the student is signed out; an outage (5xx, timeouts, no network) keeps
the session and shows "Couldn't reach Priority. Check your connection."

## Where tokens live

Nothing is ever written to `UserDefaults` or to logs. The whole session (access token, refresh token
and expiry, one JSON payload) is a single Keychain generic password item with service
`com.prioritycapstone.Priority` and accessibility
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, so it survives restarts but never syncs to other
devices; every `SecItemAdd`/`SecItemDelete`/`SecItemCopyMatching` status is checked in
`ios/Priority/TokenStore.swift`. The only thing `UserDefaults` holds is a non-secret flag saying a
sign-out delete failed and must be retried next launch.

Sign-in error messages match the website exactly:

| Supabase `error_code` | Message |
| --- | --- |
| `invalid_credentials` | Wrong email or password. Check them and try again. |
| `email_not_confirmed` | Confirm your email first. Check your inbox for the link. |
| network failure | Couldn't reach Priority. Check your connection. |
| anything else | Something went wrong. Please try again. |

## Tests

The pure auth logic (error-code mapping, token-expiry window, response parsing, URL building, config
validation) is covered by the `PriorityTests` unit test bundle:

```bash
xcodebuild -project ios/Priority.xcodeproj -scheme Priority -destination 'platform=iOS Simulator,name=iPhone 15' test
```

If the destination name is ambiguous on your machine, use a device id from `xcrun simctl list devices available`.
