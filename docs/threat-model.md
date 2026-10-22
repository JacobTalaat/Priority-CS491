# Threat model

We protect students' Canvas tokens and calendar feed URLs, their grades, syllabi and accounts, and our AI budget. This describes main today.

| Risk | What we do | Status |
| --- | --- | --- |
| Canvas token or feed URL stolen from the database | AES-256-GCM with one server-held key (`src/lib/secrets.ts`). Whoever has the server env can decrypt them; the key has no rotation. | Partly fixed |
| SSRF through a student's Canvas or feed URL | Only public https hosts, checked again after DNS on every request, including IPv4 hidden in IPv6; Canvas and feed redirects are refused (`src/lib/public-host.ts`). DNS rebinding between our check and the connection remains. | Partly fixed |
| Reading another student's data | Student routes take the user from the session and scope every query by `userId`; a foreign course id is a 404 (`src/app/api/`). | Fixed |
| Direct access through the Supabase Data API | RLS on with no policies for every current table; each new table must enable it in its migration. | Fixed |
| Password guessing and stolen hashes | Accounts live in Supabase Auth, so this app stores no passwords and no sessions (`src/lib/supabase.ts`); Supabase rate-limits sign-ins by IP. Our old per-email limit went with our own login route. | Partly fixed |
| Session token stolen from localStorage by XSS | React escapes output and no raw HTML is rendered, but there is no Content-Security-Policy. | Accepted until a CSP is added |
| Prompt injection from a syllabus | Sent as delimited data, reply parsed as strict JSON, nothing saved until the student confirms (`src/lib/syllabus-reader.ts`). It can still skew suggestions. | Accepted: student reviews every value |
| Running up the AI bill | Each call reserves its cost against one monthly cap first (`src/lib/ai-spend.ts`). Anyone can sign up, so one account can use the whole cap. | Partly fixed: per-student limit is PR-127 |
| Secrets in logs | One fixed-string log line; a test checks tokens, feeds, keys and prompts stay out of errors (`src/lib/log-safety.test.ts`). | Fixed |

Not covered: no audit log of logins or deletions, and syllabus text sent to the AI provider is outside our account deletion.
