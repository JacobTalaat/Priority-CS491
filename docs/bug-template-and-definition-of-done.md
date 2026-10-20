# Bug report template and Definition of Done

## Jira bug template

Use this description for every Jira Bug. Keep all fields; write “Not applicable” when a field does not apply.

```text
Platform (required): [ ] Web  [ ] iPhone app  [ ] Both  [ ] API only

Steps to reproduce:
1.
2.
3.

Expected:

Actual:
```

When useful, include the browser/device, OS version, and test account type (never include passwords, access tokens, or real student data).

## Definition of Done — proposed for team agreement

A story or bug is done only when all applicable items are true:

- Its acceptance criteria are clear and each is verified; any unsupported platform or out-of-scope behavior is called out in the PR.
- The implementation handles the expected flow and relevant loading, empty, validation, and error states.
- Focused automated tests pass, along with the project checks that apply (`npm test`, `npm run lint`, and `npm run typecheck` for the web/API; an Xcode build and simulator check for iPhone changes).
- API documentation and user-facing documentation are updated when the change affects them.
- The PR records verification results, receives approval from at least one teammate, and is merged to `main`.
- Any known follow-up work is recorded rather than hidden by closing the story.

**Meeting decision — not yet recorded**

- Meeting date:
- Attendees:
- Decision: Pending team discussion and agreement.
- Changes agreed by the team:
