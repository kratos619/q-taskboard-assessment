# TERMINAL_LOG

Session log in assignment order. Commands are copy-pasteable; the app runs via
Docker at `http://localhost:3000`, DB seeded (seed untouched).

Seed users (all `password123`):
- `meera@taskboard.dev` — admin on Q3 Launch
- `dev@example.com` — **viewer** on Q3 Launch

Reusable setup:

```bash
login() { curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -H "X-Forwarded-For: ${2:-10.0.0.1}" \
  -d "{\"email\":\"$1\",\"password\":\"${3:-password123}\"}"; }

MEERA=$(login meera@taskboard.dev 10.0.0.1 | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
DEV=$(login dev@example.com   10.0.0.2 | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
PID=cmrtcthjv0006lm5rigunhfbd   # Q3 Launch
TID=cmrtcthk6000vlm5r2xoj9v1n   # a task in Q3 Launch
```

---

## 1. Setup

```bash
docker compose up -d          # db + web
# web env now includes AIRTABLE_* via env_file: .env (compose change)
```

```
Container q-taskboard-assessment-db-1   Running
Container q-taskboard-assessment-web-1  Started
```

---

## 2. Initial test run

```bash
docker exec q-taskboard-assessment-web-1 npx vitest run
```

```
 ✓ src/tests/schemas.test.ts (7 tests)
 ✓ src/tests/auth.test.ts   (2 tests)
 ✓ src/tests/TaskCard.test.tsx (3 tests)
 ✓ src/tests/api.test.ts    (5 tests)   <- new: the 4 fixes

 Test Files  4 passed (4)
      Tests  17 passed (17)
```

---

## 3. Bug proof — #1 SQL injection (BEFORE fix)

Pre-fix route (`06a863d`) interpolates `q` into `$queryRawUnsafe`. Swap it into
the live container and inject a `UNION` to dump the `users` table:

```bash
F='src/app/api/projects/[id]/tasks/route.ts'
git checkout 06a863d -- "$F"          # restore vulnerable version into the mount
sleep 4                               # turbopack recompiles

curl -s -G "http://localhost:3000/api/projects/$PID/tasks" \
  --data-urlencode "q=zz%') UNION SELECT id,email,password_hash,name,'todo',null,id,0,created_at,updated_at FROM users --" \
  -H "Authorization: Bearer $MEERA"
```

Response — every user's email + bcrypt hash leaked through the "task" fields:

```
rows returned: 5
  LEAKED: lina@example.com     -> $2a$10$NzsDsmfOd7degT.WYc5Rf.lRSPTtCI95w.TJSHlgQ1THFMNd0rN7i
  LEAKED: dev@example.com      -> $2a$10$NzsDsmfOd7degT.WYc5Rf.lRSPTtCI95w.TJSHlgQ1THFMNd0rN7i
  LEAKED: arjun@taskboard.dev  -> $2a$10$NzsDsmfOd7degT.WYc5Rf.lRSPTtCI95w.TJSHlgQ1THFMNd0rN7i
  LEAKED: meera@taskboard.dev  -> $2a$10$NzsDsmfOd7degT.WYc5Rf.lRSPTtCI95w.TJSHlgQ1THFMNd0rN7i
  LEAKED: kavya@example.com    -> $2a$10$NzsDsmfOd7degT.WYc5Rf.lRSPTtCI95w.TJSHlgQ1THFMNd0rN7i
```

---

## 4. Fix proof — #1 SQL injection (AFTER fix)

```bash
git checkout HEAD -- "$F"             # restore fixed version (parameterized findMany)
sleep 4

curl -s -G "http://localhost:3000/api/projects/$PID/tasks" \
  --data-urlencode "q=zz%') UNION SELECT id,email,password_hash,name,'todo',null,id,0,created_at,updated_at FROM users --" \
  -H "Authorization: Bearer $MEERA"
```

```
{"tasks":[]}
```

Same payload is now a literal search term — no rows, no user data. **Fixed.**

### Other three fixes (smoke test, current/fixed state)

**#2 — password hashes no longer in project detail:**
```bash
curl -s "http://localhost:3000/api/projects/$PID" -H "Authorization: Bearer $MEERA" \
  | grep -oE 'passwordHash|password_hash|\$2a\$'      # -> (no output)
# owner object returned: {"id":"...","name":"Meera Iyer","email":"meera@taskboard.dev"}
```

**#3 — viewer cannot update a task:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "http://localhost:3000/api/tasks/$TID" \
  -H "Authorization: Bearer $DEV" -H 'Content-Type: application/json' \
  -d '{"title":"hacked by viewer"}'
# 403   body: {"error":"viewers cannot edit tasks"}   (title unchanged)
```

**#4 — login rate limited (11 failed attempts from one IP):**
```bash
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "attempt $i -> %{http_code}\n" -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' -H 'X-Forwarded-For: 198.51.100.9' \
    -d '{"email":"meera@taskboard.dev","password":"wrongpassword"}'
done
# attempts 1-10 -> 401,  attempt 11 -> 429
```

---

## 5. Part 3c — Airtable export demo

_TODO: export run output + Airtable screenshot/share link + second run showing uniqueness._

## 6. Part 3a / 3b demos

_TODO._

---

## 7. Final test run

```bash
docker exec q-taskboard-assessment-web-1 npx vitest run
```

```
 Test Files  4 passed (4)
      Tests  17 passed (17)
```
