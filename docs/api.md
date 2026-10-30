# API reference

Every route the backend serves is written down here with an example request and response, so the website and the iOS app can be built against it.

The base URL for local development is `http://localhost:3000`. Every request and response body is JSON (`application/json`). Routes that take a body say so in their **Request** part; routes that take none say "No body".

Dynamic path segments keep the name of their Next.js folder, for example `/api/tasks/[id]`.

When a route is added, removed, or changed, update this file in the same pull request. `src/app/api/api-doc.test.ts` reads the route files under `src/app/api` and fails when they disagree with this file, so the doc cannot drift silently.

## Routes

### `GET /api/health`

Reports whether the app can reach its PostgreSQL database. Clients can use it as a readiness probe before calling any other route.

- **Method**: `GET`
- **Path**: `/api/health`

**Request**

No body.

```bash
curl http://localhost:3000/api/health
```

**Response**

`200` — the database answered the query:

```json
{
  "status": "ok"
}
```

`503` — the database is unreachable:

```json
{
  "status": "error"
}
```

### `POST /api/auth/signup`

Creates a student account, then creates a session token for that account.

- **Method**: `POST`
- **Path**: `/api/auth/signup`

**Request**

JSON body with:

- `email` (string)
- `password` (string, minimum 8 characters)

```bash
curl -i -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"correct-horse"}'
```

**Response**

`201` — account and session created:

```json
{
  "token": "opaque-bearer-token",
  "expiresAt": "2026-11-06T18:00:00.000Z",
  "user": {
    "id": 1,
    "email": "student@example.com"
  }
}
```

`400` — malformed body, invalid email, or password shorter than 8 characters:

```json
{
  "error": "Invalid body"
}
```

`409` — email already registered:

```json
{
  "error": "Email already registered"
}
```

### `POST /api/auth/login`

Authenticates an existing account and returns a new session token.

- **Method**: `POST`
- **Path**: `/api/auth/login`

**Request**

JSON body with:

- `email` (string)
- `password` (string, minimum 8 characters)

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"correct-horse"}'
```

**Response**

`200` — credentials valid:

```json
{
  "token": "opaque-bearer-token",
  "expiresAt": "2026-11-06T18:00:00.000Z",
  "user": {
    "id": 1,
    "email": "student@example.com"
  }
}
```

`400` — malformed body, invalid email, or password shorter than 8 characters:

```json
{
  "error": "Invalid body"
}
```

`401` — email/password pair is not valid:

```json
{
  "error": "Invalid email or password"
}
```

`429` — too many failed login attempts within the rate limit window. The response includes a `Retry-After` header with the whole seconds remaining:

```json
{
  "error": "Too many login attempts"
}
```

### `POST /api/auth/refresh`

Rotates the current session: deletes the row for the presented token and creates a fresh session with a new token and expiry.

- **Method**: `POST`
- **Path**: `/api/auth/refresh`

**Request**

No body. Send an `Authorization` header with the bearer token from sign up, log in, or a previous refresh. The presented token is invalidated by the response.

```bash
curl -i -X POST http://localhost:3000/api/auth/refresh \
  -H "Authorization: ******"
```

**Response**

`200` — session rotated:

```json
{
  "token": "new-opaque-bearer-token",
  "expiresAt": "2026-11-06T18:00:00.000Z",
  "user": {
    "id": 1,
    "email": "student@example.com"
  }
}
```

`401` — token missing, malformed, invalid, or expired:

```json
{
  "error": "Unauthorized"
}
```

### `GET /api/auth/me`

Returns the currently authenticated user from the bearer token in `Authorization`.

- **Method**: `GET`
- **Path**: `/api/auth/me`

**Request**

No body. Send an `Authorization` header with the bearer token from sign up or log in.

```bash
curl -i http://localhost:3000/api/auth/me \
  -H "Authorization: ******"
```

**Response**

`200` — token valid and session active:

```json
{
  "id": 1,
  "email": "student@example.com"
}
```

`401` — token missing, malformed, invalid, or expired:

```json
{
  "error": "Unauthorized"
}
```

### `POST /api/ask`

Answers a question about the student's classes using only the passages Priority retrieves from the student's saved syllabi, Canvas assignments (including their scores), and grade setup class details. For each question, the question and up to 8 retrieved passages from the student's own data are sent to the AI provider. When the AI can support an answer from those passages, each source it cites is built server-side from the matched passage: the source identifies the passage, and the `quote` is an excerpt the AI copied from it, verified to appear in the passage before being returned. A `found: false` response is a best effort: it means the AI could not support an answer from the matched data, not a guarantee that the data lacks it.

Logging: every question that reaches the answering step is stored against the student's account for the team's accuracy study. Each row keeps the question, the outcome (`found`, `not-found`, `failed`, or `cap-reached`), the answer when the outcome is `found`, the exact sources shown to the student for that answer, the course the question was scoped to, and the time. Rows are deleted with the account. Questions that produce a 502 or 503 response are recorded too; validation errors and questions for a course that is not the student's current course are not.

- **Method**: `POST`
- **Path**: `/api/ask`

**Request**

JSON body with:

- `question` (string, 1–500 characters) — the student's question.
- `courseId` (string, optional) — when given, only that course's data is searched.

```bash
curl -i -X POST http://localhost:3000/api/ask \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"question":"When is homework 3 due?","courseId":"course-id"}'
```

**Response**

`200` — the AI supported an answer from the retrieved passages; every source is one of the passages Priority retrieved and its `quote` is a verified excerpt of that passage, possibly from anywhere inside it:

```json
{
  "found": true,
  "answer": "Homework 3 is due Friday, October 23 at 11:59 PM.",
  "sources": [
    {
      "n": 2,
      "kind": "assignment",
      "courseId": "course-id",
      "courseName": "Data Structures",
      "source": {
        "assignmentId": "assignment-id",
        "title": "Homework 3",
        "htmlUrl": "https://canvas.example.edu/courses/1/assignments/3"
      },
      "quote": "due Fri Oct 23, 2026 11:59 PM"
    }
  ]
}
```

The `kind` is `syllabus`, `assignment`, or `class-details`. The `source` object for a syllabus is `{ "fileName": "syllabus.pdf", "start": 0, "end": 45 }`, for an assignment `{ "assignmentId": "assignment-id", "title": "Homework 3", "htmlUrl": "https://..." }`, and for class details `{ "fields": ["instructor"] }`. If any cited excerpt had not appeared in its passage, the whole reply is rejected and the request returns `502`.

`200` — the AI could not support an answer from the syllabus and Canvas data Priority retrieved; this is a best effort, not a guarantee the data lacks it:

```json
{
  "found": false,
  "message": "Priority couldn't find that in your syllabus or Canvas data."
}
```

`400` — invalid body or a question outside the 1–500 character bound:

```json
{
  "error": "Invalid body"
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the given `courseId` is not a current course belonging to the student:

```json
{
  "error": "Current course not found."
}
```

`503` — the AI budget cap for this month has been reached:

```json
{
  "error": "Priority's AI budget for this month is used up, so it couldn't answer. Try again later."
}
```

`502` — any other AI failure, including a retrieved-data read failure, a reply the strict parser rejected, or a cited excerpt that did not appear in its passage:

```json
{
  "error": "Priority couldn't answer that right now. Try again."
}
```

### `POST /api/account/delete`

Deletes the currently authenticated account after confirming its password.

- **Method**: `POST`
- **Path**: `/api/account/delete`

**Request**

Send an `Authorization` bearer token and the account password in the JSON body.

```json
{
  "password": "your-password"
}
```

**Response**

`200` — account deleted:

```json
{
  "deleted": true
}
```

`400` — password is missing or invalid:

```json
{
  "error": "Password is required."
}
```

`401` — token missing, invalid, expired, or account no longer exists:

```json
{
  "error": "Unauthorized"
}
```

`403` — password is incorrect:

```json
{
  "error": "Password is incorrect."
}
```

`429` — too many wrong passwords for this account; the `Retry-After` header carries the seconds remaining:

```json
{
  "error": "Too many password attempts."
}
```

### `GET /api/notifications/preferences`

Returns the authenticated student's notification toggles and the nightly reminder time. Times and days are in New York time.

- **Method**: `GET`
- **Path**: `/api/notifications/preferences`

**Request**

No body. Send an `Authorization` header with the Priority bearer token.

```bash
curl -i http://localhost:3000/api/notifications/preferences \
  -H "Authorization: Bearer opaque-bearer-token"
```

**Response**

`200` — the saved preferences. `notifyTonight` controls the "Tonight" nudge, `notifyGradePosted` the "Grade posted" message, and `notifyDueTomorrow` the "Due tomorrow" message. `nightlyReminderTime` is a zero-padded `HH:MM` string used by the nightly reminder job:

```json
{
  "notifyTonight": true,
  "notifyGradePosted": true,
  "notifyDueTomorrow": true,
  "nightlyReminderTime": "20:00"
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `PATCH /api/notifications/preferences`

Updates some or all of the notification preferences. Only the fields present in the body are changed; the others are left as they are.

- **Method**: `PATCH`
- **Path**: `/api/notifications/preferences`

**Request**

JSON body with any subset of:

- `notifyTonight` (boolean) — whether the student gets the "Tonight" nudge
- `notifyGradePosted` (boolean) — whether the student gets the "Grade posted" message
- `notifyDueTomorrow` (boolean) — whether the student gets the "Due tomorrow" message
- `nightlyReminderTime` (string) — `HH:MM` between `00:00` and `23:59`, New York time

```bash
curl -i -X PATCH http://localhost:3000/api/notifications/preferences \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"notifyTonight":false,"nightlyReminderTime":"21:30"}'
```

**Response**

`200` — the preferences after the update, same shape as `GET`:

```json
{
  "notifyTonight": false,
  "notifyGradePosted": true,
  "notifyDueTomorrow": true,
  "nightlyReminderTime": "21:30"
}
```

`400` — an unknown field, a non-boolean toggle, or an invalid `nightlyReminderTime` (wrong format or outside `00:00`–`23:59`):

```json
{
  "error": "Send notifyTonight, notifyGradePosted and notifyDueTomorrow as true or false, and nightlyReminderTime as HH:MM from 00:00 to 23:59."
}
```

`400` — the body is not valid JSON or not an object:

```json
{
  "error": "Invalid JSON body."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `GET /api/push/public-key`

Returns the server's VAPID public key, for the browser to subscribe against (the website fetches this in Settings instead of baking the key into the bundle).

- **Method**: `GET`
- **Path**: `/api/push/public-key`

**Request**

No body. Send an `Authorization` header with the Priority bearer token — every route the app serves needs a session unless it is deliberately public.

```bash
curl -i http://localhost:3000/api/push/public-key \
  -H "Authorization: Bearer opaque-bearer-token"
```

**Response**

`200` — signing key material the browser needs for `PushManager.subscribe`'s `applicationServerKey`:

```json
{
  "publicKey": "BEl62iLg1Lt1uQ2bQMBM81DiZHt8_XdJNXt6FJH4zI2g..."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `POST /api/push/subscriptions`

Saves the browser's web push subscription for the authenticated student. Repeating the request updates the saved subscription for that endpoint. When the endpoint belongs to another account, it is moved to the caller only if `p256dh` and `auth` are unchanged — those keys prove it is literally the same browser subscription; otherwise the request is refused so nobody can silently disown another student's device. The endpoint must point at one of Priority's supported push services (Google, Mozilla, Apple, Windows). Each user keeps at most ten subscriptions; the one least recently delivered is dropped, never the row just saved.

- **Method**: `POST`
- **Path**: `/api/push/subscriptions`

**Request**

JSON body with the subscription the browser made (the whole body must be under 4 KB):

- `endpoint` (string) — the push service URL, `https` only, no port other than 443, no embedded credentials, at most 1000 characters
- `keys.p256dh` (string) — base64url uncompressed P-256 public key (65 bytes starting with `0x04`), checked as a real curve point
- `keys.auth` (string) — base64url auth secret, exactly 16 bytes

```bash
curl -i -X POST http://localhost:3000/api/push/subscriptions \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://fcm.googleapis.com/fcm/send/abc","keys":{"p256dh":"BPk_1...","auth":"aB_1..."}}'
```

**Response**

`200` — the subscription is saved:

```json
{
  "subscribed": true
}
```

`400` — the body is not valid JSON, not an object, over 4 KB, the endpoint is missing or not an `https` URL, it is over 1000 characters, a key is missing or malformed, or the endpoint does not point at a supported push service:

```json
{
  "error": "Send endpoint as the https push service URL your browser gave you (at most 1000 characters), keys.p256dh as its uncompressed P-256 public key, and keys.auth as its 16-byte secret."
}
```

`400` — the endpoint is fine `https` but names another host:

```json
{
  "error": "Only Priority's supported push services (Google, Mozilla, Apple or Windows) can be used."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`409` — the endpoint currently belongs to another account and its stored keys differ from the request's, so it cannot be taken over:

```json
{
  "error": "This browser subscription belongs to another account. Turn notifications off there first."
}
```

### `DELETE /api/push/subscriptions`

Removes the authenticated student's own subscription for an endpoint. Endpoints that belong to another account are never touched.

- **Method**: `DELETE`
- **Path**: `/api/push/subscriptions`

**Request**

JSON body with:

- `endpoint` (string) — the push service URL of the subscription to remove

```bash
curl -i -X DELETE http://localhost:3000/api/push/subscriptions \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://fcm.googleapis.com/fcm/send/abc"}'
```

**Response**

`200` — whether a saved subscription of the caller's was removed:

```json
{
  "removed": true
}
```

`200` — nothing was removed (the endpoint is unknown or belongs to another account):

```json
{
  "removed": false
}
```

`400` — the body is not valid JSON, not an object, or `endpoint` is missing:

```json
{
  "error": "Send endpoint as the subscription to remove."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `POST /api/push/test`

Sends one fixed test message ({ "title": "Priority", "body": "Notifications are on.", "url": "/today" }) to each of the caller's saved subscriptions and reports the counts. `removed` counts subscriptions deleted because the push service answered 404 or 410 — the only statuses that say the browser subscription is gone; everything else (transport errors, timeouts, rate limits, server errors) is counted under `failed` and the subscription stays. The limit of three calls per user per 10 minutes is counted per server instance (in memory), so it resets on deploy/restart; `Retry-After` carries the seconds remaining.

- **Method**: `POST`
- **Path**: `/api/push/test`

**Request**

No body. Send an `Authorization` header with the Priority bearer token.

```bash
curl -i -X POST http://localhost:3000/api/push/test \
  -H "Authorization: Bearer opaque-bearer-token"
```

**Response**

`200` — the sends went out; `sent` counts deliveries the push service accepted, `failed` the ones it rejected or that errored, and `removed` the subscriptions deleted because the push service said they no longer exist:

```json
{
  "sent": 2,
  "failed": 0,
  "removed": 0
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the caller has no saved subscriptions yet:

```json
{
  "error": "No saved browser subscription. Turn notifications on first."
}
```

`429` — more than three test sends in 10 minutes; `Retry-After` carries the seconds remaining:

```json
{
  "error": "Too many test notifications. Try again later."
}
```

### `POST /api/canvas/token`

Saves the student's Canvas personal access token. The token is checked against Canvas first and only stored if Canvas accepts it. It is encrypted before it is written and is never returned by any route.

- **Method**: `POST`
- **Path**: `/api/canvas/token`

**Request**

JSON body with:

- `token` (string) — a Canvas personal access token
- `baseUrl` (string, optional) — the Canvas origin, for example `https://njit.instructure.com`. Defaults to `CANVAS_BASE_URL`. Must be `https` with no path.

```bash
curl -i -X POST http://localhost:3000/api/canvas/token \
  -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d '{"token":"******","baseUrl":"https://njit.instructure.com"}'
```

**Response**

`200` — Canvas accepted the token and it was stored:

```json
{
  "connected": true,
  "canvasUser": {
    "id": 69783,
    "name": "Jacob Moawad"
  }
}
```

`400` — the body was invalid, the Canvas URL was not a valid `https` origin, Canvas rejected the token, or Canvas answered with a redirect (redirects are never followed; the message names the redirect target so the student can paste that address instead):

```json
{
  "error": "Canvas redirected to https://canvas.njit.edu. Use that address instead."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`502` — Canvas could not be reached (including an address that resolves to a private IP):

```json
{
  "error": "Could not reach Canvas"
}
```

### `GET /api/canvas/token`

Reports whether the student has connected Canvas. Never returns the token itself.

- **Method**: `GET`
- **Path**: `/api/canvas/token`

**Request**

No body.

```bash
curl -i http://localhost:3000/api/canvas/token \
  -H "Authorization: ******"
```

**Response**

`200` — current connection state:

```json
{
  "connected": true,
  "baseUrl": "https://njit.instructure.com",
  "checkedAt": "2026-10-07T18:30:00.000Z"
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `DELETE /api/canvas/token`

Disconnects Canvas by clearing the stored credentials.

- **Method**: `DELETE`
- **Path**: `/api/canvas/token`

**Request**

No body.

```bash
curl -i -X DELETE http://localhost:3000/api/canvas/token \
  -H "Authorization: ******"
```

**Response**

`200` — credentials cleared:

```json
{
  "connected": false
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `POST /api/canvas/token/test`

Re-checks the stored Canvas token against Canvas. On success the stored "last checked" time is updated. A rejected token is reported but left in place, so the student can replace it rather than silently losing the connection.

- **Method**: `POST`
- **Path**: `/api/canvas/token/test`

**Request**

No body.

```bash
curl -i -X POST http://localhost:3000/api/canvas/token/test \
  -H "Authorization: ******"
```

**Response**

`200` — Canvas still accepts the stored token:

```json
{
  "ok": true,
  "canvasUser": {
    "id": 69783,
    "name": "Jacob Moawad"
  }
}
```

`400` — Canvas rejected the stored token, or Canvas answered with a redirect (redirects are never followed; the message names the redirect target so the student can correct the stored address):

```json
{
  "error": "Canvas redirected to https://canvas.njit.edu. Use that address instead."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`409` — the student has not connected Canvas:

```json
{
  "error": "Canvas not connected"
}
```

`502` — Canvas could not be reached:

```json
{
  "error": "Could not reach Canvas"
}
```

`500` — the check failed for a reason that is not Canvas, for example the database was unreachable:

```json
{
  "error": "Token check failed"
}
```

### `GET /api/canvas/courses`

Returns the current-term courses imported for the authenticated student. Courses are returned only while Canvas is connected.

- **Method**: `GET`
- **Path**: `/api/canvas/courses`

**Request**

No body. Send an `Authorization` header with the Priority bearer token.

```bash
curl -i http://localhost:3000/api/canvas/courses \
  -H "Authorization: ******"
```

**Response**

`200` — current connection state and imported current-term courses:

```json
{
  "connected": true,
  "courses": [
    {
      "id": "course-id",
      "name": "Introduction to Computer Science",
      "courseCode": "CS-100",
      "term": "Fall 2026",
      "termEndsAt": "2026-12-22T05:00:00.000Z"
    }
  ]
}
```

When Canvas is not connected, the response is `{"connected":false,"courses":[]}`.

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `GET /api/canvas/calendar-feed`

Reports whether a private Canvas calendar feed link is saved for the authenticated student. The feed URL is never returned because it grants access to calendar data.

- **Method**: `GET`
- **Path**: `/api/canvas/calendar-feed`

**Request**

No body.

```bash
curl -i http://localhost:3000/api/canvas/calendar-feed \
  -H "Authorization: ******"
```

**Response**

`200` — feed configuration state:

```json
{
  "configured": true
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `POST /api/canvas/calendar-feed`

Saves or replaces the student's Canvas calendar feed link. Only public HTTPS links are accepted. The private link is encrypted at rest and is not returned after saving.

- **Method**: `POST`
- **Path**: `/api/canvas/calendar-feed`

**Request**

JSON body with `feedUrl` (string), copied from Canvas Calendar:

```bash
curl -i -X POST http://localhost:3000/api/canvas/calendar-feed \
  -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d '{"feedUrl":"https://canvas.example.edu/feeds/calendar.ics?token=******"}'
```

**Response**

`200` — link saved:

```json
{
  "configured": true
}
```

`400` — invalid request body or an invalid/non-HTTPS feed link:

```json
{
  "error": "Use a public HTTPS Canvas calendar feed link."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`502` — feed link is unavailable or does not return valid iCalendar data:

```json
{
  "error": "Could not read the Canvas calendar feed. Check that the link is current and publicly accessible."
}
```

### `DELETE /api/canvas/calendar-feed`

Removes the saved Canvas calendar feed link.

- **Method**: `DELETE`
- **Path**: `/api/canvas/calendar-feed`

**Request**

No body.

```bash
curl -i -X DELETE http://localhost:3000/api/canvas/calendar-feed \
  -H "Authorization: ******"
```

**Response**

`200` — feed link removed:

```json
{
  "configured": false
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `GET /api/canvas/sync`

Reports when the student's Canvas data was last fully synced, so clients can show a "last synced" time without triggering a sync.

- **Method**: `GET`
- **Path**: `/api/canvas/sync`

**Request**

No body.

```bash
curl -i http://localhost:3000/api/canvas/sync \
  -H "Authorization: ******"
```

**Response**

`200` — the stored last-synced time, `null` when Canvas has never been synced:

```json
{
  "lastSyncedAt": "2026-10-07T18:30:00.000Z"
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `POST /api/canvas/sync`

Runs the Canvas import for the student right away. When the Canvas API is available, it imports courses, assignment groups, assignments, and grades. If no token is saved, or Canvas is unreachable or returns a server error, and a calendar feed is saved, it instead imports dated assignment events from that feed for the student's already imported current courses. A token that Canvas rejects is never hidden behind the feed: it returns `400` so the student knows to reconnect. All writes are idempotent upserts. After a complete successful Canvas listing per course, assignments and assignment groups Canvas no longer returns are removed from that course, along with the grades of removed assignments. A failed listing removes nothing, and an empty listing for a course that holds 20 or more is treated as a Canvas glitch and skipped for that sync. The last-synced time is saved only when the selected import completes successfully.

- **Method**: `POST`
- **Path**: `/api/canvas/sync`

**Request**

No body.

```bash
curl -i -X POST http://localhost:3000/api/canvas/sync \
  -H "Authorization: ******"
```

**Response**

`200` — the import completed; every count is the number of records written for that stage:

```json
{
  "lastSyncedAt": "2026-10-07T18:30:00.000Z",
  "courses": 4,
  "assignmentGroups": 7,
  "assignments": 62,
  "grades": 58
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`409` — the student has not connected Canvas:

```json
{
  "error": "Canvas not connected"
}
```

`400` — Canvas rejected the stored token:

```json
{
  "error": "Canvas rejected this token"
}
```

`502` — Canvas could not be reached:

```json
{
  "error": "Could not reach Canvas"
}
```

`502` — any other Canvas failure:

```json
{
  "error": "Canvas request failed"
}
```

`502` — the saved calendar feed is unavailable or does not contain valid iCalendar data:

```json
{
  "error": "Could not read the Canvas calendar feed. Check that the link is current and publicly accessible."
}
```

`500` — the sync failed for a reason that is not Canvas, for example the database was unreachable:

```json
{
  "error": "Sync failed"
}
```

### `POST /api/courses/[courseId]/grade-setup`

Saves and confirms a student's grading setup for one of their current courses. Category weights and the final exam weight must total 100, and every assignment in the course must map to exactly one category. Repeating the request replaces the saved setup.

- **Method**: `POST`
- **Path**: `/api/courses/[courseId]/grade-setup`

**Request**

JSON body with:

- `categories` — non-empty array of `{ "name": string, "weight": number }`; names must be unique and weights must be from 0 to 100.
- `assignmentMappings` — array of `{ "assignmentId": string, "category": string }` using assignment IDs belonging to this course.
- `finalExamWeight` — number from 0 to 100. Together with category weights it must total 100.
- `cutoffs` — object mapping grade labels to percentage cutoffs from 0 to 100.
- `classDetails` — object mapping detail names to text, numbers, or `null`.

```bash
curl -i -X POST http://localhost:3000/api/courses/course-id/grade-setup \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{
    "categories": [
      { "name": "Homework", "weight": 30 },
      { "name": "Exams", "weight": 50 }
    ],
    "assignmentMappings": [
      { "assignmentId": "assignment-id", "category": "Homework" }
    ],
    "finalExamWeight": 20,
    "cutoffs": { "A": 90, "B": 80, "C": 70 },
    "classDetails": { "instructor": "Professor Example", "section": "02" }
  }'
```

**Response**

`200` — the setup was saved:

```json
{
  "confirmed": true,
  "courseId": "course-id",
  "confirmedAt": "2026-10-11T18:30:00.000Z"
}
```

`400` — invalid setup, weights do not total 100, or assignment mappings are incomplete or refer to another course:

```json
{
  "error": "Category weights and the final exam weight must add up to 100."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the course is not a current course belonging to the student:

```json
{
  "error": "Current course not found."
}
```

### `GET /api/courses/grade-setups`

Returns the authenticated student's current courses, their Canvas assignment-group weights and assignments, and any saved confirmed grade setup. Courses are included whether or not the Canvas token is currently connected.

- **Method**: `GET`
- **Path**: `/api/courses/grade-setups`

**Request**

No body.

```bash
curl -i http://localhost:3000/api/courses/grade-setups \
  -H "Authorization: Bearer opaque-bearer-token"
```

**Response**

`200` — current courses and setup data:

```json
{
  "courses": [
    {
      "id": "course-id",
      "name": "Algorithms",
      "courseCode": "CS-341",
      "term": "Fall 2026",
      "assignmentGroups": [{ "name": "Homework", "groupWeight": 30 }],
      "assignments": [
        {
          "id": "assignment-id",
          "title": "Project 1",
          "assignmentGroup": { "name": "Homework", "groupWeight": 30 }
        }
      ],
      "gradeSetup": null
    }
  ]
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

### `POST /api/courses/[courseId]/syllabus`

Extracts the text of a syllabus PDF and saves it for one of the student's current courses. The PDF itself is never stored; only the extracted text and metadata are. Repeating the request replaces the saved syllabus with the new upload.

- **Method**: `POST`
- **Path**: `/api/courses/[courseId]/syllabus`

**Request**

`multipart/form-data` with one field:

- `file` — the syllabus PDF. It must be at most 10 MB, at most 50 pages, and its content must start with `%PDF-`. The file name and MIME type are not trusted; the file contents decide everything.

```bash
curl -i -X POST http://localhost:3000/api/courses/course-id/syllabus \
  -H "Authorization: Bearer opaque-bearer-token" \
  -F "file=@/Users/student/Downloads/syllabus.pdf"
```

**Response**

`200` — the syllabus text was extracted and saved. The route then asks the AI to pull grading rules (categories, weights, cutoffs, final exam weight, late policy, office hours, contacts) out of the saved text and returns them as `suggestions`. Suggestions are a proposal only: nothing about them is saved until the student confirms their weights. On success:

```json
{
  "syllabus": {
    "courseId": "course-id",
    "fileName": "syllabus.pdf",
    "sizeBytes": 412876,
    "pageCount": 12,
    "characterCount": 28641,
    "extractedAt": "2026-10-20T18:30:00.000Z"
  },
  "suggestions": {
    "categories": [
      { "name": "Homework", "weight": 20 },
      { "name": "Midterm", "weight": 30 },
      { "name": "Final Exam", "weight": 50 }
    ],
    "finalExamWeight": 0,
    "cutoffs": { "A": 93, "B": 83, "C": 70, "D": 60 },
    "latePolicy": "Late work loses 2 points per day, up to 5 days.",
    "officeHours": "Tue & Thu 2:00-3:30 pm",
    "contacts": [{ "name": "Dr. Elena Ruiz", "role": "Instructor", "email": "eruiz@njit.edu" }],
    "unsupportedRules": ["The lowest quiz score is dropped before averaging."]
  }
}
```

A `null` weight or field means the syllabus did not state it — never zero. The final exam is one of the categories, so `finalExamWeight` is `0` whenever the category weights account for the whole grade. `unsupportedRules` lists grading rules a simple weighted or points-based calculation cannot express (drop-lowest, replacement exams, curves, bonus caps, attendance penalties).

`200` (degraded) — the text was still extracted and saved, but the AI read failed. The status stays `200` because the student can enter their weights by hand, so this is not an error:

```json
{
  "syllabus": {
    "courseId": "course-id",
    "fileName": "syllabus.pdf",
    "sizeBytes": 412876,
    "pageCount": 12,
    "characterCount": 28641,
    "extractedAt": "2026-10-20T18:30:00.000Z"
  },
  "suggestions": null,
  "suggestionsError": "Priority's AI budget for this month is used up, so it couldn't read your syllabus. You can enter your weights by hand below."
}
```

`400` — the body was not multipart/form-data, the file field was missing or empty, or the upload was not a PDF:

```json
{
  "error": "That isn't a PDF. Download the syllabus from Canvas as a PDF and try again."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the course is not a current course belonging to the student:

```json
{
  "error": "Current course not found."
}
```

`413` — the upload is over 10 MB:

```json
{
  "error": "That PDF is over 10 MB. Try a smaller copy of the syllabus."
}
```

`422` — the PDF is unreadable, password-protected, has more than 50 pages, or looks like a scanned image. The scanned-image case reads:

```json
{
  "error": "This PDF looks like a scanned image, so Priority can't read its text. Upload a PDF with selectable text, or enter your weights by hand."
}
```

### `GET /api/courses/[courseId]`

Returns one of the student's current courses with its saved class details and its assignments. The grades are the raw stored scores (no course percentages or category breakdown here). The assignments are ordered by due date with undated last. The `officeHours`, `latePolicy` and `contacts` are read from the saved class details and are null until captured.

- **Method**: `GET`
- **Path**: `/api/courses/[courseId]`

**Request**

No body. Send an `Authorization` header with the Priority bearer token.

```bash
curl -i http://localhost:3000/api/courses/course-id \
  -H "Authorization: Bearer opaque-bearer-token"
```

**Response**

`200` — the course, its class details, and its assignments:

```json
{
  "course": {
    "id": "course-id",
    "name": "Algorithms",
    "courseCode": "CS-341",
    "term": "Fall 2026",
    "termEndsAt": "2026-12-20T00:00:00.000Z"
  },
  "details": {
    "instructor": "Professor Example",
    "section": "002",
    "credits": 3,
    "officeHours": "Tue 2-4pm, GITC 4400",
    "latePolicy": "10% off per day, max 3 days",
    "contacts": "prof@njit.edu; TA ta@njit.edu",
    "confirmedAt": "2026-10-11T18:30:00.000Z"
  },
  "assignments": [
    {
      "id": "assignment-id",
      "title": "Homework 1",
      "dueAt": "2026-09-10T03:59:00.000Z",
      "hasDueDate": true,
      "pointsPossible": 10,
      "htmlUrl": "https://canvas.example.edu/courses/1/assignments/1",
      "assignmentGroup": { "name": "Homework" },
      "grade": { "score": 9.5, "gradedAt": "2026-09-12T15:00:00.000Z" }
    }
  ]
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the course is not a current course belonging to the student:

```json
{
  "error": "Current course not found."
}
```

### `GET /api/courses/[courseId]/grade`

Returns the overall grade for one of the student's current courses and, when the course is graded by category, the grade inside each category so the student can see what is pulling the grade down. Which engine produced the grade comes back as `engine`: `weighted` when a confirmed setup with usable category weights was used, `points` otherwise (no confirmed setup, or one whose categories carry no usable weight — the weighted math would be impossible). A points grade has an empty `breakdown`; a points course has no categories.

When the grade cannot be worked out, `grade.status` says so. `insufficient-data` means nothing graded enough to produce a percentage yet (it is never a fake 0%). `unsupported.reason` explains the grading rule the engine cannot express:

- `negative-score` — a stored grade below zero.
- `non-finite-result` — the arithmetic produced a number that is not usable.

Extra credit is not a stop condition: a score above the assignment's points possible counts as-is, and a positive score on an assignment with no points possible is pure bonus, so a calculated `percentage` can exceed 100 for the course and in `breakdown`. A category whose only graded work is bonus points has no points possible to divide by, so its `breakdown.percentage` stays `null` while `pointsEarned` shows the bonus.

Each `breakdown` entry carries the category's share of the course (`weight`), the percentage earned within it, and the raw `pointsEarned` and `pointsPossible` it came from, so the figure can be checked by eye. `percentage` is `null` when nothing in the category is graded yet — different from `0`, which means graded and exactly zero points. `gradedCount` counts assignments whose grades were included in the tallies; `ungradedCount` counts mapped assignments still waiting for a grade.

The response also carries `finalExam`: the score the student needs on the final exam for each letter grade. It is only solved when the saved grade setup picked which assignment is the final exam (`classDetails.finalExamAssignmentId`) and that final does not have a grade yet. Otherwise `finalExam.status` says so: `no-final` when the setup picked nothing valid, `final-not-gradable` when the picked assignment has no gradable points, `already-graded` — a real score is never overridden with a what-if — or `final-not-counted` when the grade engine would ignore the final's score: it is mapped to no category with weight, or the setup holds the final exam's weight outside the categories (`finalExamWeight` above 0, which no engine reads). Answering then would only invent a "secured" or "out of reach". When it is `solved`, `results` holds one entry per letter among A, B, and C. A letter uses its plain cutoff when the setup has one, otherwise the lowest cutoff in its family (for example `B-` when only `B+` and `B-` are set), named by that label. An entry is `needed` with `score` in final-exam points and `percent` as a share of the final's points possible (both rounded up, so entering exactly the reported numbers cannot fall short, and never above a perfect final), `secured` when even a 0 on the final reaches the cutoff, `out-of-reach` with `best`, the grade a perfect final brings, or `unknown` when the grade engine cannot grade the course.

The needed score assumes every other ungraded assignment keeps counting the way the engine counts it today: ungraded work is left out of the grade, so the rest of the current average holds as-is. If more ungraded work is graded later, the real grade can land lower or higher than predicted, so `secured` and `out-of-reach` are only certain when nothing else is still to be graded. `otherWorkPending` on a `solved` result is `true` when other counted work has no grade yet; the student-facing sentences then say the answer holds "if your other grades stay where they are".

The `shares` array says how much each assignment is worth toward the final grade, one `{ assignmentId, share, category }` entry per assignment in the same order as the course's assignments. In a weighted course, a share is the assignment's points possible over the total points possible of every assignment mapped to its category (graded or not) times the category's weight, and `category` names the category it was mapped to. In a points course, a share is the assignment's points possible over the course's total points times 100, and `category` is always `null`. `null` means the assignment sits outside the grading math entirely — unmapped in a weighted course, or mapped to a category that carries no weight — while `0` means it is inside the math but carries no points, so it cannot move the grade. Shares depend on no grades, so they come back even when `grade.status` is `insufficient-data` or `unsupported`. If the saved setup gives the final exam a weight outside the categories (`finalExamWeight` above 0), that weight belongs to no assignment, so every share is `null`: any number would be wrong about the final. Make the final exam its own category to get shares.

- **Method**: `GET`
- **Path**: `/api/courses/[courseId]/grade`

**Request**

No body. Send an `Authorization` header with the Priority bearer token.

```bash
curl -i http://localhost:3000/api/courses/course-id/grade \
  -H "Authorization: Bearer opaque-bearer-token"
```

**Response**

`200` — a weighted course with a confirmed setup, graded in both categories:

```json
{
  "course": {
    "id": "course-id",
    "name": "Algorithms",
    "courseCode": "CS-341",
    "term": "Fall 2026"
  },
  "setupConfirmed": true,
  "engine": "weighted",
  "grade": { "status": "calculated", "percentage": 80.4 },
  "breakdown": [
    {
      "category": "Homework",
      "weight": 40,
      "percentage": 81,
      "pointsEarned": 81,
      "pointsPossible": 100,
      "gradedCount": 2,
      "ungradedCount": 0
    },
    {
      "category": "Exams",
      "weight": 60,
      "percentage": 80,
      "pointsEarned": 120,
      "pointsPossible": 150,
      "gradedCount": 1,
      "ungradedCount": 0
    }
  ],
  "finalExam": { "status": "no-final" },
  "shares": [
    { "assignmentId": "hw-1", "share": 20, "category": "Homework" },
    { "assignmentId": "hw-2", "share": 20, "category": "Homework" },
    { "assignmentId": "exam-1", "share": 60, "category": "Exams" }
  ]
}
```

`200` — a course graded on total points instead, so there is no breakdown:

```json
{
  "course": {
    "id": "course-id",
    "name": "Algorithms",
    "courseCode": "CS-341",
    "term": "Fall 2026"
  },
  "setupConfirmed": false,
  "engine": "points",
  "grade": { "status": "calculated", "percentage": 75 },
  "breakdown": [],
  "finalExam": { "status": "no-final" },
  "shares": [
    { "assignmentId": "hw-1", "share": 25, "category": null },
    { "assignmentId": "proj-1", "share": 75, "category": null }
  ]
}
```

`200` — nothing graded enough to produce a grade:

```json
{
  "course": {
    "id": "course-id",
    "name": "Algorithms",
    "courseCode": "CS-341",
    "term": "Fall 2026"
  },
  "setupConfirmed": true,
  "engine": "weighted",
  "grade": { "status": "insufficient-data" },
  "breakdown": [
    {
      "category": "Homework",
      "weight": 40,
      "percentage": null,
      "pointsEarned": 0,
      "pointsPossible": 0,
      "gradedCount": 0,
      "ungradedCount": 1
    }
  ],
  "finalExam": { "status": "no-final" },
  "shares": [{ "assignmentId": "hw-1", "share": 40, "category": "Homework" }]
}
```

`200` — extra credit is counted as Canvas counts it, so a grade can land above 100. The exam scored 110 of 100 and counts as-is; a positive score on an assignment with no points possible would instead be pure bonus, adding to the earned totals without touching the possible ones:

```json
{
  "course": {
    "id": "course-id",
    "name": "Algorithms",
    "courseCode": "CS-341",
    "term": "Fall 2026"
  },
  "setupConfirmed": true,
  "engine": "weighted",
  "grade": { "status": "calculated", "percentage": 102 },
  "breakdown": [
    {
      "category": "Homework",
      "weight": 40,
      "percentage": 90,
      "pointsEarned": 45,
      "pointsPossible": 50,
      "gradedCount": 1,
      "ungradedCount": 0
    },
    {
      "category": "Exams",
      "weight": 60,
      "percentage": 110,
      "pointsEarned": 110,
      "pointsPossible": 100,
      "gradedCount": 1,
      "ungradedCount": 0
    }
  ],
  "finalExam": { "status": "no-final" },
  "shares": [
    { "assignmentId": "hw-1", "share": 20, "category": "Homework" },
    { "assignmentId": "exam-1", "share": 60, "category": "Exams" }
  ]
}
```

`200` — a grading rule the engine cannot express, with the reason carried through:

```json
{
  "course": {
    "id": "course-id",
    "name": "Algorithms",
    "courseCode": "CS-341",
    "term": "Fall 2026"
  },
  "setupConfirmed": true,
  "engine": "weighted",
  "grade": { "status": "unsupported", "reason": "negative-score" },
  "breakdown": [],
  "finalExam": { "status": "no-final" },
  "shares": [
    { "assignmentId": "hw-1", "share": 20, "category": "Homework" },
    { "assignmentId": "exam-1", "share": 60, "category": "Exams" }
  ]
}
```

`200` — the setup picked the final exam and its grade has not landed yet, so every letter in the cutoffs is priced out. Homework sits at 80% (worth 40% of the course, with the final exam worth the other 60%), which is also the current displayed grade while the final is ungraded. The grade with the final scored `x` points is 32 + 0.6x, so an A needs 96.67 of the final's 100 points (96.7%), a B exactly 80 (80%), and a C 63.34 (63.4%):

```json
{
  "course": {
    "id": "course-id",
    "name": "Algorithms",
    "courseCode": "CS-341",
    "term": "Fall 2026"
  },
  "setupConfirmed": true,
  "engine": "weighted",
  "grade": { "status": "calculated", "percentage": 80 },
  "breakdown": [
    {
      "category": "Homework",
      "weight": 40,
      "percentage": 80,
      "pointsEarned": 80,
      "pointsPossible": 100,
      "gradedCount": 1,
      "ungradedCount": 0
    },
    {
      "category": "Final Exam",
      "weight": 60,
      "percentage": null,
      "pointsEarned": 0,
      "pointsPossible": 0,
      "gradedCount": 0,
      "ungradedCount": 1
    }
  ],
  "finalExam": {
    "status": "solved",
    "results": [
      { "letter": "A", "status": "needed", "score": 96.67, "percent": 96.7 },
      { "letter": "B", "status": "needed", "score": 80, "percent": 80 },
      { "letter": "C", "status": "needed", "score": 63.34, "percent": 63.4 }
    ],
    "otherWorkPending": false
  },
  "shares": [
    { "assignmentId": "hw-1", "share": 40, "category": "Homework" },
    { "assignmentId": "final-1", "share": 60, "category": "Final Exam" }
  ]
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the course is not a current course belonging to the student:

```json
{
  "error": "Current course not found."
}
```

### `POST /api/assignments/[assignmentId]/plan`

Asks the AI to break one of the student's current-course assignments into 3 to 7 concrete steps with minute estimates, so tonight can start instead of being spent staring at the work. Nothing about the plan is saved; ask again any time. The due date in the prompt is rendered in `America/New_York` campus time.

- **Method**: `POST`
- **Path**: `/api/assignments/[assignmentId]/plan`

**Request**

JSON body with:

- `hoursAvailable` (number, optional, between 0.5 and 12) — the hours the student has tonight. When given, the plan's steps must total no more than that time; when omitted, only the per-step bounds apply. The body itself is optional.

```bash
curl -i -X POST http://localhost:3000/api/assignments/assignment-id/plan \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"hoursAvailable": 2.5}'
```

**Response**

`200` — the plan, with `totalMinutes` equal to the sum of the step minutes:

```json
{
  "steps": [
    { "title": "Skim the project brief and pick a topic", "minutes": 15 },
    { "title": "Draft the two-page outline", "minutes": 45 },
    { "title": "Review the sources and submit", "minutes": 20 }
  ],
  "totalMinutes": 80
}
```

`400` — `hoursAvailable` was present but not a number between 0.5 and 12:

```json
{
  "error": "Send hoursAvailable as a number of hours between 0.5 and 12."
}
```

`400` — the body was not valid JSON or was not an object:

```json
{
  "error": "Invalid JSON body."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the assignment does not belong to a current course of this student:

```json
{
  "error": "Assignment not found."
}
```

`503` — Priority's AI budget for this month is used up:

```json
{
  "error": "Priority's AI budget for this month is used up, so it couldn't plan this assignment. Try again next month."
}
```

`502` — any other AI failure, for example the provider was unreachable or its answer did not parse into a valid plan:

```json
{
  "error": "Priority couldn't turn this assignment into steps right now. Try again in a little while."
}
```

---

### `POST /api/events`

Records one usage event for the study. Both the website and the iOS app call it. Only the signed-in user's id, the event name, the client, and the time are stored — the body cannot carry any other fields, and event names are short identifiers, never free text.

The website currently sends `app_open` (a signed-in page load), `sync_now` (a successful Canvas sync), and `setup_confirmed` (a saved grade setup). The iOS app sends its own events with `client` set to `app`.

- **Method**: `POST`
- **Path**: `/api/events`

**Request**

JSON body with exactly:

- `event` (string) — lowercase identifier, letters, digits, and `_`, with optional `.` sections, at most 64 characters, for example `app_open` or `today.mark_done`
- `client` (string) — `web` or `app`

```bash
curl -i -X POST http://localhost:3000/api/events \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"event":"app_open","client":"web"}'
```

**Response**

`201` — the event was stored:

```json
{
  "ok": true
}
```

`400` — malformed body, an event name that isn't an identifier, an unknown client, or extra fields:

```json
{
  "error": "Invalid body"
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

---

### `GET /api/today`

Returns the student's ranked to-do list in one call, so the website and the mobile app show the same order. Only work the student can still act on is listed: graded work, work already handed in, and excused work never appear. Work the student marked done — even if Canvas has not graded it yet — and work skipped for today's New York day never appear either; skipping comes back the next New York day, and undone work becomes eligible again. An item an undo (or a skip's expiry) makes eligible only shows up again if it is still open: not graded, not handed in, not excused, and not more than 7 New York calendar days overdue. Items are grouped by their due calendar day in New York; overdue work from the last 7 New York calendar days is pulled into today's group — it is not simply first, and a bigger item due tonight can rank above it — while work more than 7 calendar days overdue is left out entirely. Within a day, items rank by share of the final grade divided by the estimated hours; work without a due date comes last.

- **Method**: `GET`
- **Path**: `/api/today`

**Request**

No body. Send an `Authorization` header with the Priority bearer token.

Optional query parameter `hours=N` builds a plan that fits in `N` hours of work. `N` must be a number from 0.5 to 12; anything else (a non-number, a value outside the range, or `hours` given more than once) is rejected with `400`.

```bash
curl -i http://localhost:3000/api/today \
  -H "Authorization: Bearer opaque-bearer-token"

curl -i "http://localhost:3000/api/today?hours=3" \
  -H "Authorization: Bearer opaque-bearer-token"
```

**Response**

`200` — the ranked list:

```json
{
  "generatedAt": "2026-10-14T16:30:00.000Z",
  "items": [
    {
      "rank": 1,
      "assignmentId": "assignment-id-1",
      "courseId": "course-id",
      "courseName": "Algorithms",
      "title": "Project 1",
      "dueAt": "2026-10-14T17:00:00.000Z",
      "dueDay": "2026-10-14",
      "overdue": false,
      "share": 50,
      "hours": 2,
      "estimated": true,
      "score": 25,
      "reason": "Due today, 50 percent of your grade, about 2 hours",
      "boundary": null
    },
    {
      "rank": 2,
      "assignmentId": "assignment-id-2",
      "courseId": "course-id",
      "courseName": "Algorithms",
      "title": "Quiz",
      "dueAt": "2026-10-15T17:00:00.000Z",
      "dueDay": "2026-10-15",
      "overdue": false,
      "share": 15,
      "hours": null,
      "estimated": false,
      "score": 15,
      "reason": "Due tomorrow, 15 percent of your grade, could drop you below an A",
      "boundary": { "letter": "A", "cutoff": 90, "direction": "at-risk", "distance": 2 }
    }
  ],
  "hoursFilter": null
}
```

Field meanings:

- `rank` — the item's 1-based position in the full ranked list.
- `dueAt` — the real due timestamp, `null` for work without a due date.
- `dueDay` — the item's due calendar day, `YYYY-MM-DD` in America/New_York, `null` for undated work. Overdue work keeps its real day here even though it ranks within today.
- `overdue` — true when the due time has passed.
- `share` — the item's share of the final grade in percent, `null` when the course's grading setup does not put it in the math yet.
- `hours` — the stored work estimate, `null` when nothing has stored one.
- `estimated` — `false` when `hours` is `null`; the plan fills such an item in as 1 hour, the same default the ranking's score divides by.
- `score` — `share` divided by the hours used (`null` hours count as 1), or `null` when `share` is unknown.
- `reason` — one one-line summary of why the item ranks where it does: when it is due, how much of the grade it carries, how long it takes, and any letter-cutoff risk.
- `boundary` — a letter-cutoff flag produced for the item, or `null` when no flag was produced. `null` does **not** mean the course is safe: besides the course not being near a cutoff, or the item being too small to move it, no flag is also produced when the course has no confirmed grading setup, no saved cutoffs, a grade that cannot be calculated, or a final exam weight held outside the categories. A client must never show `null` as "you are safe". When a flag is present, `direction` `at-risk` means a zero on this item could drop the grade below `letter` (`cutoff`), and `direction` `within-reach` means full marks on it could lift the grade up to that letter; `distance` is how far the current grade sits from the cutoff.

`200` — with `?hours=3`: the ranked list is walked in rank order and an item is kept while the running total of its hours fits in the budget. An item that would not fit is skipped, and smaller items further down the list still fit, so the time is filled without ever reordering. Unestimated items count as 1 hour. `plannedHours` is the total the kept items bill, `unestimatedCount` how many of them had no estimate, and `skippedCount` how many ranked items were left out because they did not fit — kept items plus `skippedCount` always add up to the full ranked list, so an empty result reads as "nothing fits" instead of "there was nothing". Kept items keep their original `rank` numbers, so a plan and the full list stay comparable:

```json
{
  "generatedAt": "2026-10-14T16:30:00.000Z",
  "items": [
    { "rank": 1, "assignmentId": "assignment-id-1", "...": "..." },
    { "rank": 3, "assignmentId": "assignment-id-3", "...": "..." }
  ],
  "hoursFilter": { "hours": 3, "plannedHours": 3, "unestimatedCount": 0, "skippedCount": 1 }
}
```

Without `?hours`, every item is returned and `hoursFilter` is `null`.

Until work estimates are stored (a later plan ticket), every item is unestimated, so each one counts as 1 hour and `?hours=N` returns the first `N` ranked items unchanged.

`400` — the `hours` query is not a number between 0.5 and 12, or given more than once:

```json
{
  "error": "Hours filter must be a number between 0.5 and 12."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

---

### `POST /api/today/items/[assignmentId]/done`

Marks one to-do item done: it disappears from `GET /api/today` immediately and stays gone until it is undone — even if Canvas has no grade for it yet. The assignment must belong to one of the student's CURRENT courses, or the route answers `404`. Every call also appends one record to the tap event log (`done`), which the ranking study later reads; the record keeps the item's course id and Canvas id, so it stays identifiable even after a sync removes the assignment row itself.

- **Method**: `POST`
- **Path**: `/api/today/items/[assignmentId]/done`

**Request**

Send an `Authorization` header with the Priority bearer token, and optionally:

- `X-Priority-Client: web` or `X-Priority-Client: app` — which client sent the tap; recorded on the event as sent. Any other value — or no header at all — is recorded as `unknown`.
- `X-Priority-Request-Id` — an idempotency key of at most 100 characters. Retrying the same action with the same key returns the first response again and never writes a second event or state change; without the key, every call counts. Clients should generate one key per tap, not per retry.
- An optional JSON body saying what the client had on screen when the student tapped, so the study can tell whether the tested behaviour sat at the top of the list: `{ "rank": <the item's rank from GET /api/today>, "listGeneratedAt": "<that response's generatedAt>" }`. Both fields are optional; the server also stores where the item sat in the list it computes at the moment of the tap (`serverRank`). A body that is not a JSON object, or a field of the wrong form, is rejected with `400`.

```bash
curl -i http://localhost:3000/api/today/items/assignment-id-1/done \
  -X POST \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "X-Priority-Client: web" \
  -H "X-Priority-Request-Id: tap-0f3e2b" \
  -d'{ "rank": 1, "listGeneratedAt": "2026-10-14T16:30:00.000Z" }'
```

**Response**

`200` — the item is done:

```json
{
  "assignmentId": "assignment-id-1",
  "status": "done"
}
```

The same request retried with the same `X-Priority-Request-Id` returns this exact body again, with no further writes.

`400` — the body is not a JSON object, `rank` is not a positive integer, `listGeneratedAt` is not an ISO date-time, or `X-Priority-Request-Id` is longer than 100 characters:

```json
{
  "error": "rank must be a positive integer."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the assignment does not exist, does not belong to the student, or belongs to one of their not-current courses:

```json
{
  "error": "Assignment not found."
}
```

---

### `POST /api/today/items/[assignmentId]/skip`

Hides one to-do item for the rest of today, in New York: it disappears from `GET /api/today` immediately and reappears at midnight ET — actually, only if it is still open (not graded, not handed in, not excused, and not more than 7 New York calendar days overdue). The assignment must belong to one of the student's CURRENT courses, or the route answers `404`. Skipping never overwrites a done state: if the item is done, the tap is logged as `skip` exactly as the student made it, but the item stays done and this route reports `done`. Every call also appends one record to the tap event log, which keeps the item's course id and Canvas id even after the assignment row is synced away.

- **Method**: `POST`
- **Path**: `/api/today/items/[assignmentId]/skip`

**Request**

Send an `Authorization` header with the Priority bearer token, and see the done route for the `X-Priority-Client`, `X-Priority-Request-Id` and JSON body (`rank` / `listGeneratedAt` from `GET /api/today`) options and its `400` responses.

```bash
curl -i http://localhost:3000/api/today/items/assignment-id-1/skip \
  -X POST \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "X-Priority-Client: app"
```

**Response**

`200` — the item is skipped for today (or reported still `done`, when it was done):

```json
{
  "assignmentId": "assignment-id-1",
  "status": "skipped"
}
```

`400` — a bad `X-Priority-Request-Id` or body, as on the done route.

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the assignment does not exist, does not belong to the student, or belongs to one of their not-current courses:

```json
{
  "error": "Assignment not found."
}
```

---

### `DELETE /api/today/items/[assignmentId]`

Undoes an item's done or skip state: the state row is removed, so `GET /api/today` lists the item again — if it is still open (not graded, not handed in, not excused, and not more than 7 New York calendar days overdue); undo does not bring back work that is no longer open. The assignment must belong to one of the student's CURRENT courses, or the route answers `404`. Every call also appends one record to the tap event log (`undo`), including a tap where there was no state left to remove — the tap itself is still what the student did. Every event keeps the item's course id and Canvas id, so study data outlives the assignment row.

- **Method**: `DELETE`
- **Path**: `/api/today/items/[assignmentId]`

**Request**

Send an `Authorization` header with the Priority bearer token; there is no body. See the `X-Priority-Client` and `X-Priority-Request-Id` header options and the `400` responses on the done route.

```bash
curl -i http://localhost:3000/api/today/items/assignment-id-1 \
  -X DELETE \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "X-Priority-Client: web" \
  -H "X-Priority-Request-Id: tap-0f3e2c"
```

**Response**

`200` — `undone` is `true` when a stored state was removed, `false` when there was none (the item was neither done nor skipped); the item shows on `GET /api/today` either way, if it is still open:

```json
{
  "assignmentId": "assignment-id-1",
  "undone": true
}
```

`400` — a bad `X-Priority-Request-Id`, as on the done route.

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`404` — the assignment does not exist, does not belong to the student, or belongs to one of their not-current courses:

```json
{
  "error": "Assignment not found."
}
```

---

### `POST /api/devices`

Registers the device token for one of the student's devices, so push notifications reach it. Each device keeps its own row: the body carries a `deviceId` (the app's stable identifier), and re-registering from the same device replaces that device's token. Students are allowed multiple devices — registering an iPhone does not retire an iPad.

A student's devices are capped at 10. Registering an extra device past the cap removes the row with the oldest update, so a device that has not re-registered for the longest time stops receiving pushes first.

A token registered by another account moves to the caller: registering a token removes it from any other row it is still tied to, including rows owned by a different student, before it is saved here. This risks breaking another app that expected its token to still report to the first account, and it is accepted on purpose: the token is an opaque per-device push address, and this app never exposes token values through any route, so a caller can only ever silence its own device.

Concurrent registrations from the same device converge on the same row; if the database reports a write conflict or unique violation from a concurrent request, the registration is retried whole, and after three failed attempts it returns `503`.

- **Method**: `POST`
- **Path**: `/api/devices`

**Request**

JSON body with:

- `token` (string) — the APNs device token, a hex string with an even number of characters, from 32 to 400 characters (case-insensitive; Apple does not fix the length in advance). It is stored lowercased.
- `platform` (string) — only `"ios"` is accepted today.
- `deviceId` (string) — a UUID identifying the device install (on iOS, `identifierForVendor`), case-insensitive. Stored lowercased.

```bash
curl -i -X POST http://localhost:3000/api/devices \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"token":"9f4b1c3d2e5a60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0","platform":"ios","deviceId":"123e4567-e89b-12d3-a456-426614174000"}'
```

**Response**

`200` — the token was registered for the device:

```json
{
  "registered": true
}
```

`400` — the body is not JSON, or a field did not validate; each error is a plain sentence naming what was wrong:

```json
{
  "error": "Device token must be a hex string of 32 to 400 characters."
}
```

```json
{
  "error": "Only the ios platform is supported."
}
```

```json
{
  "error": "deviceId must be a UUID."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`503` — the registration kept losing to a concurrent registration and ran out of retries:

```json
{
  "error": "Couldn't register this device right now. Try again."
}
```

---

### `DELETE /api/devices`

Forgets a device token, used when the student logs out. The token is validated the same way POST validates it, trimmed, and matched lowercased. A token is removed only when it belongs to the student calling the route; if it is registered to nobody, or to another account, the response is the same, so no information about other accounts leaks.

- **Method**: `DELETE`
- **Path**: `/api/devices`

**Request**

JSON body with:

- `token` (string) — the device token to forget.

```bash
curl -i -X DELETE http://localhost:3000/api/devices \
  -H "Authorization: Bearer opaque-bearer-token" \
  -H "Content-Type: application/json" \
  -d '{"token":"9f4b1c3d2e5a60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0"}'
```

**Response**

`200` — whether a token owned by the student was removed:

```json
{
  "removed": true
}
```

`400` — the body is not JSON, or the token did not validate:

```json
{
  "error": "Device token must be a hex string of 32 to 400 characters."
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

---

When you add a route, copy the section above and fill in the new route: keep the section heading in the same `METHOD /path` backticked form, and give it a **Method** line, a **Path** line, a **Request** part, and a **Response** part with a JSON example for every status code it returns.
