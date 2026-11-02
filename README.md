# Foundry — Campus Lost and Found Portal

A full-stack web application for Sai University. Students report lost belongings,
browse found items, search and filter listings, and coordinate returns through a
claim workflow that the person who posted the item reviews.

**Web Technology and Internet Programming — individual B.Tech CSE project.**

Live demo: <https://foundry-lost-and-found.onrender.com>

---

## 1. What it does

- **Register with your Sai University address only** — the `@scds.saiuniversity.edu.in`
  domain is enforced on the server, not just in the browser.
- **Report** a lost or found item, with an optional photo.
- **Search and filter** by keyword, category, location, type, status and a date range,
  with pagination so the board never silently stops at a fixed number.
- **Claim** an item by describing a detail only the owner would know, then
  confirm the handover once the item actually changes hands.
- **Review claims** on your own listings from your dashboard: approve or reject.
- **Administer** the site: statistics, charts, every listing, every claim, every
  account, plus the ability to remove a listing or change someone's role.
- **Report a listing** that looks like spam, abuse or a fake, and an
  administrator reviews it from a moderation queue.
- **Get notified** in the app when someone claims your item, when a claim is
  decided, and when an item is marked returned.
- **Earn points** when a return is completed; a public leaderboard ranks students.

### How a return actually completes

Approving a claim only **reserves** the item — it moves to `claimed` so nobody
else can claim it, and nothing else happens. The listing becomes `returned`
only when the owner presses **Confirm handover** on the approved claim, which
records who confirmed it and when (`handoverConfirmedAt`), awards the points to
both people and notifies both. Marking an item returned without a handover is
still possible from the dashboard, and both routes are recorded on the item.

The application starts **completely empty**. There are no seeded listings and no
default accounts — the first thing a visitor sees is an invitation to report
something.

## 2. Technology

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Web framework | Express 4 |
| Database | MongoDB (Atlas or local) with Mongoose 8 |
| Authentication | JSON Web Tokens + bcryptjs |
| Security | helmet, CORS, express-rate-limit |
| Frontend | Plain HTML5, CSS and ES6+ JavaScript — no framework, no build step |
| Tests | `node test/offline.test.js` (no database), `npm test` (needs MongoDB), Postman collection |

The frontend is plain HTML/CSS/JS on purpose: the brief rewards code you can
explain line by line, and there is nothing to compile or install for the demo.

## 3. Repository layout

```
foundry/
├── backend/
│   ├── server.js                  entry point: checks env, connects DB, listens
│   ├── src/
│   │   ├── app.js                 express app, middleware, routes, static serving
│   │   ├── config/db.js           mongoose connection
│   │   ├── models/                User.js, Item.js, Claim.js, Notification.js
│   │   ├── middleware/            auth.js (JWT + roles), error.js (404 + handler)
│   │   ├── routes/                auth, item, claim, dashboard, admin, leaderboard,
│   │   │                          notifications
│   │   └── utils/
│   │       ├── notify.js          writes a notification without breaking the request
│   │       ├── email.js           the university domain rule + verification tokens
│   │       └── mailer.js          sends the verification email (only when enabled)
│   ├── scripts/
│   │   ├── create-admin.js        creates the first administrator from env vars
│   │   ├── db-info.js             read-only: which database am I connected to?
│   │   └── cleanup-demo.js        removes the old seed data (dry run by default)
│   ├── test/
│   │   ├── offline.test.js        runs with no database
│   │   └── api.test.js            full API suite, needs MongoDB
│   ├── postman/                   Foundry.postman_collection.json
│   ├── .env.example               every variable, placeholders only
│   └── package.json
└── frontend/
    ├── index.html                 hero, stats, browse, filters, modals
    ├── auth.html                  log in / create account
    ├── dashboard.html             your metrics, listings, claims, edit modal
    ├── admin.html                 statistics, charts, listings, accounts, claims
    └── assets/
        ├── css/styles.css
        └── js/  api.js (shared helpers), app.js (homepage), auth.js (login)
```

## 4. Who can register

Foundry is for the Sai University community, so registration accepts **one
domain only**:

```
@scds.saiuniversity.edu.in
```

The rule lives in `backend/src/utils/email.js` and is applied in
`POST /api/auth/register`. It is enforced on the server, so a direct API call
cannot bypass it, and the browser applies the same rule first for a faster
message. The comparison is exact and case-insensitive:

| Address | Result |
|---|---|
| `audisiva.i-29@scds.saiuniversity.edu.in` | accepted |
| `STUDENT@SCDS.SAIUNIVERSITY.EDU.IN` | accepted (case-insensitive) |
| `student@gmail.com` | refused |
| `student@saiuniversity.edu.in` | refused — different domain |
| `student@scds.saiuniversity.edu.in.evil.com` | refused — suffix trick |
| `student@sub.scds.saiuniversity.edu.in` | refused — subdomain |

The domain is configurable with `ALLOWED_EMAIL_DOMAIN`, and nothing else widens
it: no extra domains and no subdomains. Registration always creates a
**student**; the role is never read from the request body. Administrators are
only created through `npm run create-admin`.

Accounts that already exist on another domain keep working — the rule applies
to new registrations, so no production account is locked out.

## 5. Setup from a fresh clone

You need Node.js 18 or newer and a MongoDB database (Atlas free tier is fine).

```bash
git clone https://github.com/jsivaramateja1-del/foundry-lost-and-found.git
cd foundry/backend
npm install
```

Create your environment file:

```bash
copy .env.example .env        # Windows cmd
cp .env.example .env          # macOS / Linux
```

Now edit `.env` and fill in at least these three values:

| Variable | Required | What it is |
|---|---|---|
| `MONGO_URI` | yes | Your MongoDB connection string, ending in `/foundry` |
| `JWT_SECRET` | yes | A long random string. The server will not start without it |
| `NODE_ENV` | yes | `development` locally, `production` when deployed |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Optional variables: `PORT` (defaults to 5000 — never set it on Render),
`JWT_EXPIRES_IN` (defaults to `7d`), `CLIENT_ORIGIN` (extra CORS origins, comma
separated; same-origin is always allowed).

> **There is no default JWT secret and no fallback.** If `JWT_SECRET` is missing,
> `server.js` refuses to start and says so. That is deliberate: a secret committed
> to a repository lets anyone forge an admin token.

Start the server:

```bash
npm start
```

Expected output:

```
MongoDB Connected: <your cluster host>
Server running on http://localhost:5000
```

Expected output:

```
MongoDB Connected: host=<your cluster host> database=foundry
Server running on http://localhost:5000
```

Open <http://localhost:5000>. Express serves the frontend from `../frontend`, so
there is only one service to run.

### Checking which database you are on

```bash
npm run db:info
```

Read-only. Prints the host, the database name, counts of users / listings /
claims, who owns the existing listings, and whether any of the old demo accounts
exist. Run it locally and compare the host and database name with the
"MongoDB Connected" line in your Render logs — if they differ, your local
commands are changing a different database from the one the live site reads.

## 6. Creating the first administrator

**No administrator account ships with this project, and no password is stored in
the source code.** You create the first admin yourself:

```bash
cd backend
set ADMIN_NAME=Your Name
set ADMIN_EMAIL=you@saiuniversity.edu.in
set ADMIN_PASSWORD=a-long-password-you-choose
npm run create-admin
```

On macOS or Linux use `export` instead of `set`. The password must be at least
8 characters. Expected output:

```
Administrator created: you@saiuniversity.edu.in
```

Running the command again with an email that already has an account promotes
that account to admin and leaves its password unchanged.

Every other account is created through the **Create account** form on the site
and starts as a normal student.

## 7. If you are upgrading from the old seeded version

Earlier versions of this project shipped a `seed.js` that created three accounts
with published passwords and twelve sample listings. That file is gone. If your
database still contains that data, remove it with:

```bash
cd backend
npm run cleanup:demo
```

That is a **dry run**: it lists the demo accounts, listings and claims it found
and deletes nothing. When you are happy with the list, run:

```bash
npm run cleanup:demo -- --apply
```

It only touches items reported by the three old demo accounts and the claims
attached to them. Listings created by real users are never removed.

**Run `npm run create-admin` first, and use an email that is not one of the three
demo addresses.** If you create your admin with `admin@saiuniversity.edu.in`,
the cleanup will delete that account along with the rest of the demo data.

## 8. Tests

```bash
cd backend
node test/offline.test.js
```

No database needed. Proves the app loads, all 24 routes are registered, the
schemas reject bad input, bcrypt and JWT round-trip, no fallback secret exists,
no demo password appears anywhere in the repository, and the old seed script is
gone, plus unit tests for the email-domain rule and the verification tokens.
Expected last line: `56 passed, 0 failed`.

```bash
npm test
```

The full API suite. It starts an in-memory MongoDB (`mongodb-memory-server`), so
the first run downloads a database binary. To run against a real database instead:

```bash
set MONGO_URI=mongodb://localhost:27017/foundry-test
npm test
```

The Postman collection in `backend/postman/` has 48 requests with assertions,
across Health, Auth, Items, Claims, Dashboards, Cleanup and Notifications. It
includes the domain-refusal case, email verification and the handover step.
It contains **no credentials** — set the collection variables `studentEmail`,
`studentPassword`, `otherEmail`, `otherPassword`, `adminEmail` and `adminPassword`
to accounts you created, and select **No Environment** so a stale environment
variable cannot shadow them. Two different students are needed because the API
refuses a claim on your own listing.

## 9. API

All responses are JSON, including errors. Every protected route requires
`Authorization: Bearer <token>`.

| Method | Path | Who |
|---|---|---|
| GET | `/api/health` | public |
| GET | `/api/auth/config` | public — allowed email domain + whether verification is on |
| POST | `/api/auth/register` | public — Sai University addresses only |
| POST | `/api/auth/verify-email` | public — consume a verification token |
| POST | `/api/auth/resend-verification` | logged in — issue a fresh token (rate limited) |
| POST | `/api/auth/login` | public |
| GET | `/api/auth/me` | logged in |
| POST | `/api/auth/logout` | logged in |
| GET | `/api/items` | public — `q`, `category`, `location`, `type`, `status`, `from`, `to`, `sort`, `page`, `limit` |
| GET | `/api/items/meta` | public — dropdown values |
| GET | `/api/items/stats` | public — genuine counters for the homepage tiles |
| GET | `/api/items/:id` | public |
| GET | `/api/items/:id/similar` | public — duplicate-item alert |
| POST | `/api/items/:id/report` | logged in — flag a listing, once per student |
| POST | `/api/items` | logged in |
| PUT | `/api/items/:id` | owner or admin |
| PATCH | `/api/items/:id/status` | owner or admin |
| DELETE | `/api/items/:id` | owner or admin |
| POST | `/api/claims` | logged in |
| GET | `/api/claims/mine` | logged in |
| GET | `/api/claims/item/:itemId` | item owner or admin |
| PATCH | `/api/claims/:id` | item owner or admin — approve or reject |
| POST | `/api/claims/:id/handover` | item owner or admin — confirm the item changed hands |
| GET | `/api/dashboard/me` | logged in |
| GET | `/api/admin/stats` | admin |
| GET | `/api/admin/items` | admin |
| GET | `/api/admin/claims` | admin |
| GET | `/api/admin/users` | admin |
| GET | `/api/admin/reports` | admin — moderation queue (`?status=open|resolved|dismissed|all`) |
| PATCH | `/api/admin/reports/:id` | admin — resolve or dismiss a report |
| PATCH | `/api/admin/users/:id/suspend` | admin — suspend or reinstate a student |
| GET | `/api/admin/audit` | admin — the last 50 administrative actions |
| PATCH | `/api/admin/items/:id/status` | admin |
| DELETE | `/api/admin/items/:id` | admin |
| PATCH | `/api/admin/users/:id/role` | admin |
| GET | `/api/leaderboard` | public |
| GET | `/api/notifications` | logged in — your newest notifications + unread count |
| PATCH | `/api/notifications/:id/read` | logged in — mark one as read |
| PATCH | `/api/notifications/read-all` | logged in — mark all as read |

## 10. Moderation

Students can flag a listing from the item dialog: spam, inappropriate,
suspicious, incorrect or other, with an optional note. One report per student
per listing — a second attempt returns `409`, and the unique index on
`{ item, reportedBy }` enforces that in the database too. You cannot report your
own listing.

Administrators get a **Reported listings** queue on the admin page, with Resolve
and Dismiss. Resolving a report is a judgement recorded against it; removing the
listing is a separate action (`DELETE /api/admin/items/:id`), so a moderator
cannot accidentally delete evidence while triaging.

**Suspending an account** blocks login and every protected route with a clear
message. Two guard rails: an administrator cannot suspend themselves, and cannot
suspend another administrator — otherwise one compromised admin could lock out
the rest. Suspended students are marked in the accounts table and can be
reinstated at any time.

**Every administrative action is recorded** in an audit log shown at the bottom
of the admin page: listing deleted, listing status changed, role changed, user
suspended or reinstated, report resolved or dismissed. The actor's email is
stored with each entry so the log still reads correctly if an account is later
removed.

## 11. Email verification (implemented, off by default)

The full flow exists: a random 32-byte token is created on registration, only
its SHA-256 hash is stored, it expires in 24 hours, it is consumed once, and
`POST /api/auth/resend-verification` issues a fresh one under a 5-per-10-minute
rate limit. `POST /api/auth/verify-email` consumes it. When verification is on,
creating a listing or a claim requires a verified address.

It is **disabled by default** because sending email needs an SMTP account,
which this project does not have. Nothing pretends otherwise:

- With `EMAIL_VERIFICATION=disabled` (the default), accounts are created
  verified and behaviour is exactly as before.
- With `EMAIL_VERIFICATION=enabled`, the server **refuses to start** unless
  `SMTP_HOST` is set, so a verification email can never be silently skipped.

To turn it on, set these in `backend/.env` (and on Render):

```
EMAIL_VERIFICATION=enabled
APP_URL=https://foundry-lost-and-found.onrender.com
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=Foundry <no-reply@saiuniversity.edu.in>
```

Any standard SMTP account works; a Gmail account with an app password is
enough for a demo. No paid service is required or recommended.

## 12. Security

- Passwords are hashed with bcrypt and never returned by any endpoint.
- Authorisation is enforced on the server in each route, never in the UI. A
  student cannot edit, delete or change the status of someone else's listing, and
  cannot read claims on it.
- Every error, including a 404 and an uncaught exception, returns JSON.
- Everything that reaches the DOM is escaped through the shared `ui.esc()` helper,
  so a listing title cannot inject script.
- Photos are shrunk in the browser and validated on the server: only PNG, JPEG or
  WebP data URLs under 400 KB, or an https link, are accepted.
- A listing in a terminal state (`returned`, `closed`) can only be reopened by an
  administrator, and a status change to the current status is refused.
- Notifications are written server-side only; the client can read them and mark
  them read, and can never create one.
- helmet sets security headers, CORS is restricted to configured origins, and
  login/registration are rate limited.
- `.env` is git-ignored; `.env.example` contains placeholders only.

## 13. Deploying to Render

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `node server.js`
- Environment variables: `MONGO_URI`, `JWT_SECRET`, `NODE_ENV=production`
  (do **not** set `PORT` — Render assigns one)

After the first deploy, create the admin account by running `npm run create-admin`
locally against the same `MONGO_URI`.

The free tier sleeps when idle, so the first request after a pause can take
30–50 seconds. That is the host, not the application.

## 14. Known limitations

- No email notifications; coordination happens inside the site through in-app
  notifications and the dashboard.
- **Email verification is implemented but switched off** until you configure
  SMTP (see section 10). Until then every account is treated as verified.
- **No password reset.** It needs working SMTP; once section 10 is configured it
  is a small addition, but it is not built and is not pretended to be.
- **Moderation is deliberately manual.** Reports are queued for an
  administrator; nothing is auto-removed or auto-suspended by a threshold.
- **No notifications to administrators** when a report arrives — the open-report
  count on the admin dashboard is the signal.
- **No QR codes, listing expiry or account deletion.** All three were
  considered and left out: QR needs an extra dependency, and expiry and account
  deletion need a data-retention policy this project does not have.
- **Campus locations are a fixed list** in `backend/src/models/Item.js`
  (Library, Main Block, Canteen, Hostel A/B, Sports Complex, Auditorium,
  Parking) plus "Other" with a free-text field. Changing the list would
  invalidate existing listings, so it is left as it is.
- **No WhatsApp integration.** The site says so plainly on the homepage; wiring
  it up would need the WhatsApp Business API and approval.
- **No independent ownership verification.** A claim is checked by whoever
  posted the listing, not by university staff. The UI does not pretend otherwise.
- **Images are stored inline** in the item document rather than in object
  storage. Fine at this scale; documented under image storage above.
- An administrator can change a role but cannot delete a user account, on
  purpose: account deletion needs a policy this project does not have.
- There is no listing expiry or archival; old listings stay until someone
  changes their status or deletes them.
