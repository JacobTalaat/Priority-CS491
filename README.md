# Priority

Priority tracker built with Next.js, Prisma, and PostgreSQL.

## Prerequisites

- Node.js LTS
- PostgreSQL, either installed locally or provided by a hosted database service

## Setup

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Create a PostgreSQL database, then edit `.env` so `DATABASE_URL` points to that database. The URL should include the host, port, database name, and credentials required by your PostgreSQL instance.

   On Supabase, open **Project Settings - Database - Connection string** and copy both:

   - the **Transaction pooler** URI (port 6543) into `DATABASE_URL`, and add `?pgbouncer=true` to the end
   - the **Session pooler** URI (port 5432) into `DIRECT_URL`

   Migrations need a connection that holds a session open, because the transaction pooler cannot keep the advisory locks Prisma takes. On a local PostgreSQL one direct URL does both jobs, so leave `DIRECT_URL` unset.

   Or run the wizard, which only asks for your database password. It works out the pooler host itself, builds both connection strings, URL encodes the password, and checks the connection:

   ```bash
   ./scripts/connect-supabase.sh
   ```

   It backs up your existing `.env` first, so you can switch back to local PostgreSQL by restoring that file. For a different project, set `SUPABASE_PROJECT_REF` before running it.

   Use the **Session pooler**, not the **Direct connection** tab, unless you know your network has IPv6. The direct host `db.PROJECT_REF.supabase.co` publishes no IPv4 address, so on an IPv4-only network it fails to connect at all. Check with `host -t A db.PROJECT_REF.supabase.co`: if it says "has no A record" you need the session pooler. Both poolers are dual stack.

3. Install dependencies (this also generates the Prisma client):

   ```bash
   npm install
   ```

4. Apply the database migrations:

   ```bash
   npm run db:migrate
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

## Environment

Real values live only in `.env` on each laptop and in the server's own environment, never in the repo. The repo carries `.env.example` with placeholders only:

- `DATABASE_URL` — PostgreSQL connection string the running app uses. On Supabase, the pooler on port 6543.
- `DIRECT_URL` — optional session connection used only by migrations. On Supabase, the session pooler on port 5432. Falls back to `DATABASE_URL` when unset.
- `CANVAS_TOKEN_ENCRYPTION_KEY` — base64 key that decodes to exactly 32 bytes (AES-256), used to encrypt Canvas tokens. Generate one with:

  ```bash
  openssl rand -base64 32
  ```

- `CANVAS_BASE_URL` — optional Canvas host, defaults to `https://canvas.instructure.com`.
- `AI_BASE_URL` — base URL of an OpenAI-compatible chat completions provider, for example `https://openrouter.ai/api/v1`. No query string, fragment, or embedded credentials.
- `AI_MODEL` — model id sent with every AI request, for example `openai/gpt-4o-mini`.
- `AI_API_KEY` — AI provider key sent as a Bearer token. It is read from the environment only on the server and is never asked for from users or sent to the browser.
- `AI_INPUT_USD_PER_MILLION_TOKENS` — input price in USD per million tokens, used to cost each request before it runs and to settle actual spend afterwards. `0` is for free models.
- `AI_OUTPUT_USD_PER_MILLION_TOKENS` — output price in USD per million tokens, same rules as the input price.
  The cap is enforced against these configured prices, so prices of `0` never use the budget.
- `AI_MONTHLY_BUDGET_USD` — hard monthly spending cap in USD across all users combined; when a request would push the month past it, the request is refused before any provider call. The meter resets each calendar month (UTC).
  A provider that ignores `max_tokens` can push one call past the cap; the call still completes, but after it settles every further call is refused for the rest of the month.
  If the process dies mid-call, its reservation stays held until the month ends. Release it only with the app stopped:

  ```sql
  UPDATE "AiSpendMonth" SET "reservedMicros" = 0 WHERE "period" = 'YYYY-MM';
  ```

- `AI_TIMEOUT_MS` — optional per-request timeout in milliseconds, defaults to `60000`. Keep it below the hosting platform's request time limit.

## Check that it works

With the app running, request the health endpoint:

```bash
curl http://localhost:3000/api/health
```

It returns `{"status":"ok"}` while the database is reachable, and `{"status":"error"}` with HTTP 503 when it is not.

## Row level security

Every table lives in the `public` schema, which Supabase exposes through an auto-generated REST API reachable with the publishable key. The `20261015170000_enable_row_level_security` migration turns row level security on for all of them and creates no policies, so that API returns nothing and rejects writes.

The app is unaffected because it connects as the table owner through Prisma, and a table owner is exempt from row level security unless `FORCE ROW LEVEL SECURITY` is set. Any new table needs the same `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` line in its migration, otherwise it is readable by anyone holding the publishable key.

## Authentication

One account works for both the website and the iPhone app. Sign up and log in return a bearer token that both clients send as `Authorization: Bearer <token>`. Routes that need a signed-in student return `401` without a valid token.

Passwords are stored as scrypt hashes, never in plain text. Tokens are opaque random strings; the database stores only their SHA-256 hash, and sessions expire after 30 days.

With the app running, sign up:

```bash
curl -i -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"correct-horse"}'
```

It returns `201` with a `token`. Then log in and capture the token:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"correct-horse"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
```

Then check the current user:

```bash
# Valid token -> 200 with { id, email }
curl -i http://localhost:3000/api/auth/me -H "Authorization: Bearer $TOKEN"

# No token -> 401
curl -i http://localhost:3000/api/auth/me

# Bad token -> 401
curl -i http://localhost:3000/api/auth/me -H "Authorization: Bearer nope"

# Wrong password -> 401
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"wrong-password"}'
```

## API docs

Every API route is documented in [`docs/api.md`](docs/api.md) with its method, path, and example request and response bodies, so the website and the iOS app can be built against it.

Update `docs/api.md` in the same pull request whenever a route is added, removed, or changed. `src/app/api/api-doc.test.ts` compares the doc against the route files and fails when they disagree.

Use the shared [cross-platform test plan](docs/test-plan.md) for API, website, and iPhone app checks on every story.

## Scripts

- `npm run dev` — start the Next.js development server
- `npm run build` — build the app for production
- `npm run start` — start the production server
- `npm run lint` — run ESLint
- `npm run typecheck` — type-check the project with TypeScript
- `npm test` — run the test suite with Vitest
- `npm run db:migrate` — create and apply Prisma migrations
