# Cross-platform test plan

Use this checklist for every story. Test against a local/test database and a throwaway account; never use production student data or credentials.

## API

- Run the focused Vitest tests for changed routes and helpers, then `npm test`, `npm run lint`, and `npm run typecheck`.
- For changed endpoints, verify a valid request, missing/invalid authentication, invalid input, user/course ownership, and the documented response and persistence behavior. Check error responses as well as success.
- Update `docs/api.md` with any route contract change; `src/app/api/api-doc.test.ts` checks that API routes are documented.

## Website

- Start with `npm run dev` and exercise each changed acceptance criterion in a browser at desktop width and a narrow mobile width.
- Check the normal flow plus loading, empty, validation, and API-error states that apply. Verify keyboard navigation, visible focus, and that forms and links work without a mouse.
- Confirm the browser console has no new errors and the UI reflects the API result.

## iPhone app

- On macOS, build with `xcodebuild -project ios/Priority.xcodeproj -scheme Priority -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build`, then run the app in the iPhone Simulator.
- Check launch, the changed screen or flow, and basic navigation and layout in the simulator. Verify VoiceOver labels for changed controls.
- The current iPhone app is a placeholder and has no API-connected student flows yet. Until a story adds one, record a successful build and launch; once implemented, exercise the same acceptance scenario against the same test account and API as the website.

## Story completion

- Confirm every acceptance criterion on each platform where the feature exists; explicitly note platforms where it is not implemented yet.
- In the PR, record the commands run, pass/fail results, and any manual platform checks. Fix failures before requesting review; merge only after a teammate reviews and approves.
