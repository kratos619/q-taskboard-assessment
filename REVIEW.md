# Code Review — TaskBoard

Security- and auth-focused review of the API routes and helpers, plus the top
cross-cutting issues in performance, architecture, data integrity, and testing.
The **top 4 issues, ranked by real business impact**, are below. All four have
been fixed on this branch; each fix ships with a failing-first test in
[`src/tests/api.test.ts`](src/tests/api.test.ts).

Run the tests: `npm test` (17 passing, incl. 5 new).

---

## 1. SQL injection in task search — Critical / Security

- **File:** [src/app/api/projects/[id]/tasks/route.ts:23-34](src/app/api/projects/[id]/tasks/route.ts#L23-L34) (pre-fix)
- **Severity:** Critical

**Issue.** The `q` search param (and `projectId`) were interpolated raw into
`prisma.$queryRawUnsafe`. Any authenticated user could inject SQL — e.g.
`UNION SELECT` to dump `users.passwordHash`, or `DROP TABLE`. This is full
database compromise: credential theft, data exfiltration, and destruction.

**Fix (applied).** Removed the raw SQL entirely and reused the `prisma.task.findMany`
pattern already present in the non-search branch, with `contains` +
`mode: "insensitive"`. The term is now passed to Prisma as bound data, never
concatenated into SQL.

**Proof (post-fix curl — injection is treated as a literal search term):**
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"meera@taskboard.dev","password":"password123"}' | jq -r .token)
PID=$(curl -s http://localhost:3000/api/projects -H "Authorization: Bearer $TOKEN" | jq -r '.projects[0].id')

# breakout attempt: q = %' OR '1'='1
curl -s "http://localhost:3000/api/projects/$PID/tasks?q=%25%27%20OR%20%271%27%3D%271" \
  -H "Authorization: Bearer $TOKEN"
# -> {"tasks":[]}   (no rows leaked, no SQL executed)
```
Pre-fix, the same request would match every row / allow arbitrary SQL.

**Test:** `Issue 1: task search is not SQL-injectable` — asserts `$queryRawUnsafe`
is never called and the term is bound as data.

---

## 2. Password hashes leaked in project detail response — Critical / Security + Data Integrity

- **File:** [src/app/api/projects/[id]/route.ts:25-40](src/app/api/projects/[id]/route.ts#L25-L40) (pre-fix)
- **Severity:** Critical

**Issue.** The GET handler used `include: { owner: true, memberships: { include:
{ user: true } }, tasks: { include: { assignee: true, createdBy: true } } }` with
no field selection, so every returned `User` carried `passwordHash`. Any project
member received co-members' bcrypt hashes for offline cracking → account takeover.
Other routes correctly use `select`; this one did not.

**Fix (applied).** Introduced a `publicUser = { select: { id, name, email } }`
projection and applied it to `owner`, `memberships.user`, `assignee`, and
`createdBy`. `passwordHash` is no longer requested from or returned by the DB.

**Test:** `Issue 2: project detail never leaks password hashes` — asserts the
Prisma query requests no `passwordHash` and includes no blind `: true` user rows.

---

## 3. Missing authorization on task update (IDOR) — High / Security + Architecture

- **File:** [src/app/api/tasks/[id]/route.ts:16-38](src/app/api/tasks/[id]/route.ts#L16-L38) (pre-fix)
- **Severity:** High

**Issue.** `PATCH /api/tasks/[id]` verified the caller was logged in but never
checked project membership or role — unlike `DELETE` in the same file. Any
authenticated user could edit *any* task in *any* project, and a project
**viewer** could edit despite being read-only: cross-tenant tampering +
privilege escalation. Root cause is architectural — auth is copy-pasted per
route rather than a shared guard, so one route silently omitted it.

**Fix (applied).** Mirrored `DELETE`: after loading the task, look up
`getProjectMembership(user.id, existing.projectId)` and require
`canEditTasks(role)` before updating; return 403 otherwise.

**Test:** `Issue 3: viewers cannot update tasks` — a viewer gets 403 and
`task.update` is never called; a member still succeeds (200).

---

## 4. No rate limiting on auth endpoints — High / Security

- **File:** [src/app/api/auth/login/route.ts:8](src/app/api/auth/login/route.ts#L8), [src/app/api/auth/register/route.ts:8](src/app/api/auth/register/route.ts#L8) (pre-fix)
- **Severity:** High

**Issue.** Login accepted unlimited attempts per IP — open to brute force and
credential stuffing → account takeover. No lockout, backoff, or captcha; register
was likewise unthrottled, enabling automated account creation.

**Fix (applied).** Added [src/lib/rate-limit.ts](src/lib/rate-limit.ts) (in-memory
fixed-window counter, keyed by client IP) and applied it: login = 10 attempts /
15 min, register = 10 / hour, returning HTTP 429 when exceeded.
*Ceiling:* the counter is per-process; swap the `Map` for Redis/Upstash for a
multi-instance deployment (noted in the file).

**Test:** `Issue 4: login is rate limited` — the 11th+ attempt from one IP
returns 429.

---

## Also found (below the top 4, by category)

- **Performance** — [projects/route.ts:10-31](src/app/api/projects/route.ts#L10-L31):
  the dashboard does `include: { tasks: true }` only to compute `tasks.length`.
  At the ~1,000-tasks/project scale the assignment specifies, this loads every
  task row for every project on each dashboard load. Use
  `_count: { select: { tasks: true } }`.
- **Data Integrity** — `User.email` has no `@unique`
  ([schema.prisma:26](prisma/schema.prisma#L26)); register's `findFirst` check
  races and login's `findFirst` returns an arbitrary duplicate. Also `assigneeId`
  is never validated as a project member or existing user
  ([tasks/route.ts:79](src/app/api/projects/[id]/tasks/route.ts#L79)).
- **Architecture** — auth is duplicated per route (root cause of #3);
  JWT is 30-day, non-revocable, and the verify algorithm is not pinned
  ([jwt.ts:7-25](src/lib/jwt.ts#L7-L25)); the token is stored in `localStorage`,
  readable by any XSS ([api-client.ts:24-27](src/lib/api-client.ts#L24-L27)).
- **Testing** — before this change, only schema + jwt unit tests existed; there
  were **zero** API/authorization/integration tests, which is why #1–#3 shipped
  uncaught.

## Files changed

| File | Change |
|------|--------|
| [src/app/api/projects/[id]/tasks/route.ts](src/app/api/projects/[id]/tasks/route.ts) | #1 — parameterized search |
| [src/app/api/projects/[id]/route.ts](src/app/api/projects/[id]/route.ts) | #2 — public-user select |
| [src/app/api/tasks/[id]/route.ts](src/app/api/tasks/[id]/route.ts) | #3 — authz on PATCH |
| [src/app/api/auth/login/route.ts](src/app/api/auth/login/route.ts) | #4 — rate limit |
| [src/app/api/auth/register/route.ts](src/app/api/auth/register/route.ts) | #4 — rate limit |
| [src/lib/rate-limit.ts](src/lib/rate-limit.ts) | #4 — new helper |
| [src/tests/api.test.ts](src/tests/api.test.ts) | tests for all four |
