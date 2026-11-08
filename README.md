# Foundry — Campus Lost & Found

A lost-and-found board for Sai University. Students report what they have lost,
post what they have found, and claim their belongings back through a verified
handover instead of a hopeful message.

Built as a B.Tech Computer Science project.

---

## 1. What it does

- **Report a lost item** or **post a found item**, with a category, campus
  location and date.
- **Search and filter** the board by type, category, location, status, date range
  and free text.
- **Claim a found item.** Only found items can be claimed, never your own, and
  never one that is already spoken for.
- **Verify a handover.** The owner approves a claim, the claimant receives a
  six-digit code, and the owner enters it in person to confirm the return.
- **Earn points and badges** for verified actions — never for merely posting.
- **Faculty applications** are reviewed by an administrator before the account
  can be used.
- **Campus Explorer** plots known campus locations on a map.

---

## 2. Technology

| Layer | Choice |
| --- | --- |
| Database | **PostgreSQL 17** on Supabase, accessed with `pg` (node-postgres) |
| Backend | Node.js 20, Express 4 |
| Auth | JWT with a `token_version` check, bcrypt password hashing |
| Email | **Brevo** HTTP API (transactional email) |
| Frontend | Plain HTML, CSS and JavaScript — no framework, no build step |
| Maps | Leaflet, self-hosted under `frontend/assets/vendor/` |
| Tests | Node scripts, Playwright for the browser suite |
| CI | GitHub Actions against a real `postgres:16` service |

> **MongoDB is gone.** The project was originally built on MongoDB with Mongoose
> and was migrated completely to PostgreSQL. No Mongoose code, dependency or
> test remains, and CI fails if one is reintroduced.

---

## 3. Repository layout

```
backend/
  server.v2.js              entry point — validates config, connects, listens
  src/
    app.v2.js               Express app: middleware, route mounting, error handling
    config/pg.js            connection pool, TLS modes, transaction helper
    lib/brevo.js            email client and all seven templates
    middleware/
      auth.v2.js            JWT verification, role guards
      rateLimit.js          IP and account limiters
    repositories/           all SQL lives here
      users.js  items.js  claims.js  points.js  notify.js  badges.js
    routes/
      auth.v2.routes.js     register, verify, resend, login, reset, preferences
      items.v2.routes.js    board, search, create, edit, moderation
      claims.v2.routes.js   claim, review, handover
      misc.v2.routes.js     notifications, dashboard, leaderboard, campus,
                            reports, admin
    utils/categories.js     category tree shared by the API and the form
  db/schema.sql             the whole schema — idempotent, safe to re-run
  scripts/create-admin-pg.js
  test/
    auth-v2.test.js         domain rule and email templates (no database)
    pg.integration.test.js  the API against a real Postgres
    boot-v2.test.js         the server actually starts
    deploy.test.js          the command the platform runs
    browser/app.spec.js     Playwright against the real UI

frontend/
  index.html                the board
  auth.html                 sign in, register, verify
  dashboard.html            your listings, claims, badges, leaderboard
  admin.html                moderation and administration
  explorer.html             campus map
  forgot-password.html  reset-password.html
  assets/js/                api.js, auth.js, app.js, dashboard.js, admin.js …
```

---

## 4. Setup

You need **Node.js 20** and a **PostgreSQL database** (Supabase free tier is
enough).

```bash
cd backend
npm install
cp .env.example .env        # then fill it in
npm run db:init             # applies db/schema.sql
npm start                   # http://localhost:5000
```

Create your first administrator once you have registered an account:

```bash
npm run create-admin -- you@saiuniversity.edu.in superadmin
```

The server refuses to start without `JWT_SECRET` and `DATABASE_URL`, and prints
the sender address at boot so you can see whether email is configured.

---

## 5. Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Use the Supabase **shared pooler** string, not the direct one |
| `JWT_SECRET` | **yes** | Long random string. There is no fallback |
| `APP_URL` | **yes in production** | Absolute base URL for links in email |
| `BREVO_API_KEY` | for email | Must start with `xkeysib-`; needs *Transactional email: All* |
| `BREVO_SENDER` | for email | A verified Brevo sender address |
| `NODE_ENV` | recommended | `production` enforces the CORS allow-list |
| `CLIENT_ORIGIN` | in production | Comma-separated allowed origins |
| `PG_CA_CERT_PATH` | recommended | Path to `prod-ca-2021.crt` for verified TLS |
| `PG_SSL_NO_VERIFY` | fallback | `true` accepts any certificate. Logs a warning |
| `PG_POOL_MAX` | optional | Pool size **per process** (default 10) |

### Why the pooler string

Supabase's **direct** connection (`db.<ref>.supabase.co:5432`) is IPv6-only on
the free plan, and Render has no outbound IPv6 — so it fails with
`ENETUNREACH`, which looks like a credentials problem. The **shared pooler**
(`aws-<n>-<region>.pooler.supabase.com`, user `postgres.<ref>`) is IPv4 and
works. The code warns at startup if `DATABASE_URL` points at the direct host.

---

## 6. Who can register

| Address | Becomes |
| --- | --- |
| `…@scds.saiuniversity.edu.in` | student |
| `…@sas`, `…@sol`, `…@sahs.saiuniversity.edu.in` | student |
| `…@saiuniversity.edu.in` (no subdomain) | **pending faculty application** |
| anything else | refused |

Any subdomain of `saiuniversity.edu.in` is a student address. The bare parent
domain is staff, and staff are not self-service: the account is created with
`pending_approval = true` and cannot sign in until an administrator approves it.

Lookalikes such as `saiuniversity.edu.in.evil.com` and
`notsaiuniversity.edu.in` are refused — the domain is compared exactly after the
`@`, never with a suffix match on the raw string.

---

## 7. Account lifecycle

1. **Register.** The account is created unverified. A verification email is sent.
2. **Verify.** The link carries a token whose SHA-256 hash is stored, valid for
   24 hours and usable once.
3. **Sign in.** Refused if the address is unverified, the account is pending
   approval, or it is suspended.
4. **Lost the email?** `POST /api/auth/resend-verification` issues a fresh link.
   It answers identically whether or not the account exists.
5. **Forgot the password?** A reset link valid for one hour. Resetting bumps
   `token_version`, which retires every existing session.

A faculty applicant goes through the same steps, plus an administrator decision.

---

## 8. Roles

| Role | Can |
| --- | --- |
| `student` | post, edit and delete their own listings; claim; confirm their own handover |
| `faculty` | the same as a student. It is a label, **not** a staff role |
| `moderator` | hide a listing; restore a hidden listing to `open` — never their own, and never one that is visible |
| `admin` | moderation, suspend and reinstate accounts, approve applications, verify found listings |
| `superadmin` | everything above, plus changing roles and creating campus locations |

Authorization is enforced on the server. The UI hides controls it knows will be
refused, but nothing depends on that.

---

## 9. Points and badges

Points are awarded **only for verified actions**.

| Action | Points | When |
| --- | --- | --- |
| Found item verified | 2 | A moderator verifies the listing |
| Item returned | 10 | A handover is completed |

Posting a listing earns nothing. Claiming earns nothing. A double award is
impossible: `point_events` has a unique `(user_id, event_key)` and the award is
`INSERT … ON CONFLICT DO NOTHING` inside the same transaction as the user total.

| Badge | Earned by |
| --- | --- |
| First Found Item | 1 verified found listing |
| Helpful Finder | 3 verified found listings |
| Successful Return | 1 completed return |
| Community Helper | 5 completed returns |
| Trusted Member | 10 completed returns |

Badges are never revoked. Students may opt out of the leaderboard; opted-out
students and non-students never appear on it.

---

## 10. API

All responses are JSON, including errors. Authenticated routes need
`Authorization: Bearer <token>`.

### Auth — `/api/auth`
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/config` | accepted domains, whether email is configured |
| POST | `/register` | creates a student, or a pending faculty application |
| GET | `/verify?token=` | verifies from a link |
| POST | `/verify-email` | same, with the token in the body |
| POST | `/resend-verification` | new link; non-enumerating |
| POST | `/login` | returns a token |
| POST | `/forgot-password` | always answers the same way |
| POST | `/reset-password` | retires all existing sessions |
| PATCH | `/preferences` | leaderboard opt-out (students only) |
| POST | `/logout` | acknowledgement; tokens are stateless |
| GET | `/me` | the signed-in user |

### Items — `/api/items`
`GET /` (filters: `type category location status subcategory q from to sort page limit`),
`GET /stats`, `GET /meta`, `GET /:id`, `GET /:id/similar`, `POST /`,
`PUT /:id`, `DELETE /:id`, `PATCH /:id/status`.

### Claims — `/api/claims`
`POST /`, `GET /mine` (includes the handover code), `GET /received`,
`PATCH /:id/review`, `POST /:id/complete`.

### Everything else
`GET/PATCH /api/notifications` (`/read-all`, `/:id/read`), `GET /api/dashboard/me`,
`GET /api/leaderboard?period=week|month|all`, `GET/POST /api/campus/locations`,
`POST /api/reports`, and the admin surface under `/api/admin`: `GET /stats`,
`/items`, `/claims`, `/reports`, `/audit`, `/users`; `PATCH /items/:id/verify`,
`/items/:id/status`, `/users/:id/approve`, `/users/:id/suspend`,
`/users/:id/role`, `/reports/:id`; `DELETE /items/:id`.

---

## 11. Database

Nine tables: `users`, `items`, `claims`, `point_events`, `notifications`,
`reports`, `audit_logs`, `campus_locations`, `user_badges`.

Design notes worth knowing for a viva:

- **UUID primary keys**, and `CHECK` constraints carry the enums (`role`,
  `status`, `type`, `category`, `location`, `reason`).
- **`point_events` has a unique `(user_id, event_key)`.** That single index is
  what makes crediting idempotent — it replaced an unbounded marker array on the
  user document in the Mongo design.
- **Claim approval and handover are real transactions.** `approve()` locks the
  item row, refuses unless it is still `open`, marks the claim approved, rejects
  every sibling with a note, and moves the item to `claimed` — all or nothing.
  `complete()` marks the claim completed, the item returned, and credits both
  parties exactly once.
- **Full-text search** uses a GIN index over `to_tsvector('simple', …)`.
- `db/schema.sql` is idempotent and CI applies it twice to prove that.

---

## 12. Testing

```bash
npm run test:auth-v2     # domain rule and templates — no database needed
npm run test:pg          # the API against a real Postgres (TEST_DATABASE_URL)
npm run test:boot-v2     # the server actually starts and serves
npm run test:deploy      # runs `npm run start:pg`, the command the platform runs
npm run test:browser     # Playwright against the real UI
```

`TEST_DATABASE_URL` must point at a **disposable** database: the suites truncate
their tables.

Two suites refuse to skip when `CI=true`. A skip in CI is a lie — the workflow is
supposed to provide a database.

---

## 13. Continuous integration

One job, against a real `postgres:16` service:

1. `npm ci`
2. syntax-check every JavaScript file, including `server.v2.js`
3. **fail if any file imports Mongoose**
4. apply `db/schema.sql`, twice
5. auth unit tests
6. PostgreSQL integration tests
7. boot the real server
8. **run the deploy command exactly as the platform does**
9. seed, install Chromium, run the browser tests
10. `npm audit`

Step 8 exists because CI once tested the code and never the deployment, and two
outages reached production with a green pipeline.

---

## 14. Deploying

Render, root directory = repository root.

| Setting | Value |
| --- | --- |
| Build Command | `cd backend && npm install` |
| Start Command | `cd backend && npm run start:pg` |
| Health check | `/api/health/ready` |

Set `DATABASE_URL` (pooler), `JWT_SECRET`, `APP_URL`, `BREVO_API_KEY`,
`BREVO_SENDER`, `NODE_ENV=production`, `CLIENT_ORIGIN`.

Apply the schema once against the production database:

```bash
cd backend && DATABASE_URL="<pooler string>" npm run db:init
```

---

## 15. Known limitations

Stated plainly, because they are real:

- **Email deliverability.** Brevo flags a `gmail.com` sender as a freemail domain
  that fails DMARC alignment, so Gmail and Yahoo may spam-filter or reject
  verification mail. A domain with SPF, DKIM and DMARC fixes it. The resend link
  and an administrator's ability to verify an account are the workarounds.
- **No campus seeder.** `campus_locations` is created but never populated; the
  Explorer page is empty until an administrator adds each location.
- **No ledger reconciliation tool.** There is no script to compare
  `users.points` against the sum of `point_events`.
- **No reapplication after rejection.** A rejected faculty account keeps its row,
  and the unique email index means re-registering returns 409.
- **TLS is not exercised in CI.** The deploy check uses a local plain Postgres,
  so the Supabase certificate path is verified only in production.
- **The Render Start Command is not recorded in the repository.** If it is edited
  in the dashboard, nothing in CI notices.

---

## 16. Licence

Academic project, Sai University.
