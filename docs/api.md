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

---

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

---

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

---

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

---

### `DELETE /api/auth/account`

Permanently deletes the authenticated student's Priority account after an explicit confirmation. Related Priority records, including sessions, encrypted Canvas credentials, courses, assignments, grades, and grade setups, are removed through database cascades. This does not delete data stored by Canvas or revoke a Canvas access token in Canvas.

- **Method**: `DELETE`
- **Path**: `/api/auth/account`

**Request**

Send an `Authorization` header with the Priority bearer token and a JSON body that confirms the deletion:

```bash
curl -i -X DELETE http://localhost:3000/api/auth/account \
  -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d '{"confirmation":"DELETE"}'
```

**Response**

`200` — the account and associated Priority records were deleted:

```json
{
  "deleted": true
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`400` — deletion confirmation is missing or invalid:

```json
{
  "error": "Type DELETE to confirm account deletion."
}
```

---

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

---

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

`400` — the body was invalid, the Canvas URL was not a valid `https` origin, or Canvas rejected the token:

```json
{
  "error": "Canvas rejected this token"
}
```

`401` — no valid app session:

```json
{
  "error": "Unauthorized"
}
```

`502` — Canvas could not be reached:

```json
{
  "error": "Could not reach Canvas"
}
```

---

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

---

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

---

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

`400` — Canvas rejected the stored token:

```json
{
  "error": "Canvas rejected this token"
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

---

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

---

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

---

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

---

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

---

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

---

### `POST /api/canvas/sync`

Runs the Canvas import for the student right away. When the Canvas API is available, it imports courses, assignment groups, assignments, and grades. If no token is saved, or Canvas is unreachable or returns a server error, and a calendar feed is saved, it instead imports dated assignment events from that feed for the student's already imported current courses. A token that Canvas rejects is never hidden behind the feed: it returns `400` so the student knows to reconnect. All writes are idempotent upserts. The last-synced time is saved only when the selected import completes successfully.

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

---

### `GET /api/courses/[courseId]/grade`

Returns the current grade and per-category percentage for one of the authenticated student's current courses. The current grade is the weighted average of categories with graded work; categories without grades and the reserved final-exam weight are excluded until they have graded work. A grade setup that is missing, invalid, or no longer maps every current assignment is reported as unsupported.

- **Method**: `GET`
- **Path**: `/api/courses/[courseId]/grade`

**Request**

No body. Send an `Authorization` header with the Priority bearer token.

```bash
curl -i http://localhost:3000/api/courses/course-id/grade \
  -H "Authorization: ******"
```

**Response**

`200` — supported current grade and category breakdown:

```json
{
  "courseId": "course-id",
  "supported": true,
  "currentGrade": 83.75,
  "categories": [
    { "name": "Homework", "weight": 30, "grade": 90 },
    { "name": "Exams", "weight": 50, "grade": 80 }
  ],
  "message": null
}
```

When setup is unsupported, `supported` is `false`, `currentGrade` is `null`, and `message` explains why. A supported setup with no weighted graded work has a `null` current grade and a message of `"No weighted graded work yet."`.

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

---

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

---

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
          "dueAt": "2026-10-20T23:59:00.000Z",
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

---

When you add a route, copy the section above and fill in the new route: keep the section heading in the same `METHOD /path` backticked form, and give it a **Method** line, a **Path** line, a **Request** part, and a **Response** part with a JSON example for every status code it returns.
