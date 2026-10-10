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

- `DATABASE_URL` — PostgreSQL connection string for Prisma.
- `CANVAS_TOKEN_ENCRYPTION_KEY` — base64 key that decodes to exactly 32 bytes (AES-256), used to encrypt Canvas tokens. Generate one with:

  ```bash
  openssl rand -base64 32
  ```

- `CANVAS_BASE_URL` — optional Canvas host, defaults to `https://canvas.instructure.com`.

## Check that it works

With the app running, request the health endpoint:

```bash
curl http://localhost:3000/api/health
```

It returns `{"status":"ok"}` while the database is reachable, and `{"status":"error"}` with HTTP 503 when it is not.

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

## Scripts

- `npm run dev` — start the Next.js development server
- `npm run build` — build the app for production
- `npm run start` — start the production server
- `npm run lint` — run ESLint
- `npm run typecheck` — type-check the project with TypeScript
- `npm test` — run the test suite with Vitest
- `npm run db:migrate` — create and apply Prisma migrations
