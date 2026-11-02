# Foundry — Campus Lost and Found Portal

A full-stack web application for Sai University. Students report lost belongings,
browse found items, search and filter listings, and coordinate returns through a
claim workflow that the person who posted the item reviews.

**Web Technology and Internet Programming — individual B.Tech CSE project.**

Live demo: <https://foundry-lost-and-found.onrender.com>

---

## 1. What it does

- **Report** a lost or found item, with an optional photo.
- **Search and filter** by keyword, category, location, type, status and a date range.
- **Claim** an item by describing a detail only the owner would know.
- **Review claims** on your own listings from your dashboard: approve or reject.
- **Administer** the site: statistics, charts, every listing, every claim, every
  account, plus the ability to remove a listing or change someone's role.
- **Earn points** when a return is completed; a public leaderboard ranks students.

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
│   │   ├── models/                User.js, Item.js, Claim.js
│   │   ├── middleware/            auth.js (JWT + roles), error.js (404 + handler)
│   │   └── routes/                auth, item, claim, dashboard, admin, leaderboard
│   ├── scripts/
│   │   ├── create-admin.js        creates the first administrator from env vars
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

## 4. Setup from a fresh clone

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

Open <http://localhost:5000>. Express serves the frontend from `../frontend`, so
there is only one service to run.

## 5. Creating the first administrator

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

## 6. If you are upgrading from the old seeded version

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

## 7. Tests

```bash
cd backend
node test/offline.test.js
```

No database needed. Proves the app loads, all 24 routes are registered, the
schemas reject bad input, bcrypt and JWT round-trip, no fallback secret exists,
no demo password appears anywhere in the repository, and the old seed script is
gone. Expected last line: `16 passed, 0 failed`.

```bash
npm test
```

The full API suite. It starts an in-memory MongoDB (`mongodb-memory-server`), so
the first run downloads a database binary. To run against a real database instead:

```bash
set MONGO_URI=mongodb://localhost:27017/foundry-test
npm test
```

The Postman collection in `backend/postman/` has 30+ requests with assertions.
It contains **no credentials** — set the collection variables `studentEmail`,
`studentPassword`, `otherEmail`, `otherPassword`, `adminEmail` and `adminPassword`
to accounts you created, and select **No Environment** so a stale environment
variable cannot shadow them. Two different students are needed because the API
refuses a claim on your own listing.

## 8. API

All responses are JSON, including errors. Every protected route requires
`Authorization: Bearer <token>`.

| Method | Path | Who |
|---|---|---|
| GET | `/api/health` | public |
| POST | `/api/auth/register` | public |
| POST | `/api/auth/login` | public |
| GET | `/api/auth/me` | logged in |
| POST | `/api/auth/logout` | logged in |
| GET | `/api/items` | public — `q`, `category`, `location`, `type`, `status`, `from`, `to`, `sort`, `page`, `limit` |
| GET | `/api/items/meta` | public — dropdown values |
| GET | `/api/items/:id` | public |
| GET | `/api/items/:id/similar` | public — duplicate-item alert |
| POST | `/api/items` | logged in |
| PUT | `/api/items/:id` | owner or admin |
| PATCH | `/api/items/:id/status` | owner or admin |
| DELETE | `/api/items/:id` | owner or admin |
| POST | `/api/claims` | logged in |
| GET | `/api/claims/mine` | logged in |
| GET | `/api/claims/item/:itemId` | item owner or admin |
| PATCH | `/api/claims/:id` | item owner or admin |
| GET | `/api/dashboard/me` | logged in |
| GET | `/api/admin/stats` | admin |
| GET | `/api/admin/items` | admin |
| GET | `/api/admin/claims` | admin |
| GET | `/api/admin/users` | admin |
| PATCH | `/api/admin/items/:id/status` | admin |
| DELETE | `/api/admin/items/:id` | admin |
| PATCH | `/api/admin/users/:id/role` | admin |
| GET | `/api/leaderboard` | public |

## 9. Security

- Passwords are hashed with bcrypt and never returned by any endpoint.
- Authorisation is enforced on the server in each route, never in the UI. A
  student cannot edit, delete or change the status of someone else's listing, and
  cannot read claims on it.
- Every error, including a 404 and an uncaught exception, returns JSON.
- Everything that reaches the DOM is escaped through the shared `ui.esc()` helper,
  so a listing title cannot inject script.
- Photos are shrunk in the browser and validated on the server: only PNG, JPEG or
  WebP data URLs under 400 KB, or an https link, are accepted.
- helmet sets security headers, CORS is restricted to configured origins, and
  login/registration are rate limited.
- `.env` is git-ignored; `.env.example` contains placeholders only.

## 10. Deploying to Render

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `node server.js`
- Environment variables: `MONGO_URI`, `JWT_SECRET`, `NODE_ENV=production`
  (do **not** set `PORT` — Render assigns one)

After the first deploy, create the admin account by running `npm run create-admin`
locally against the same `MONGO_URI`.

The free tier sleeps when idle, so the first request after a pause can take
30–50 seconds. That is the host, not the application.

## 11. Known limitations

- No password reset flow.
- No email notifications; all coordination happens inside the site.
- Claims are reviewed by whoever posted the listing, not by university staff.
- Photos are stored inline in the item document, which keeps deployment simple
  but is not how you would store images in a larger system.
- There is no focus trap in the item modal: Tab can leave the dialog.
- Keyword search covers the title, description and custom category — not the
  location. Use the Location filter for that.
