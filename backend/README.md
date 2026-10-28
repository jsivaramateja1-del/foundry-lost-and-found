# Foundry — Campus Lost & Found Portal

A full-stack web application for Sai University where students report lost belongings, browse found items, search and filter listings, and coordinate returns through a claim workflow.

**Web Technology and Internet Programming — Individual Project (20 marks)**

---

## 1. What this project contains

- REST API built with **Node.js + Express.js**
- **MongoDB** database with Mongoose models and CRUD operations
- **JWT authentication** with student and admin roles, protected routes
- **Lost/found reports** with validation and optional image
- **Search and filters** — keyword, category, location, listing type, status, sorting
- **Claim management** — submit, review, approve, reject, with status tracking
- **User dashboard** — personal listings, claims and counters
- **Admin dashboard** — statistics, chart data, all listings and claims
- **Custom feature: duplicate-item alerts** — flags likely matches for an item
- **Gamification** — points and a leaderboard for completed returns
- **Postman collection** with 30+ requests and test assertions

The frontend is built separately and served from `../frontend`.

---

## 2. Technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Web framework | Express.js 4 |
| Database | MongoDB (Atlas or local) |
| ODM | Mongoose 8 |
| Authentication | JSON Web Tokens + bcryptjs |
| Security | helmet, CORS, express-rate-limit |
| API testing | Postman, plus an automated test suite |

---

## 3. Project structure

```
foundry/
├── backend/
│   ├── server.js                  entry point, starts the server
│   ├── src/
│   │   ├── app.js                 express app, middleware, route mounting
│   │   ├── config/db.js           MongoDB connection
│   │   ├── models/                User, Item, Claim schemas
│   │   ├── middleware/            auth (JWT), error handling
│   │   └── routes/                auth, items, claims, dashboard, admin, leaderboard
│   ├── test/
│   │   ├── api.test.js            full API tests (needs MongoDB)
│   │   └── offline.test.js        checks that need no database
│   ├── postman/                   Postman collection for API evidence
│   ├── seed.js                    demo data: 3 users, 12 items, 1 claim
│   ├── .env.example               copy to .env and fill in
│   └── package.json
└── frontend/                      HTML, CSS, JavaScript
```

---

## 4. Setup

### Step 1 — Install Node.js

Download the LTS version from https://nodejs.org. Check it works:

```bash
node -v
npm -v
```

### Step 2 — Install dependencies

```bash
cd backend
npm install
```

### Step 3 — Create the database

**Option A: MongoDB Atlas (free, recommended — needed for deployment)**

1. Sign up at https://www.mongodb.com/cloud/atlas/register
2. Create a free **M0** cluster
3. Under *Database Access*, add a user with a password
4. Under *Network Access*, add IP `0.0.0.0/0` (allow from anywhere — fine for a demo)
5. Click *Connect → Drivers* and copy the connection string

**Option B: Local MongoDB**

Install from https://www.mongodb.com/try/download/community and use:

```
mongodb://localhost:27017/foundry
```

### Step 4 — Configure environment variables

```bash
cd backend
cp .env.example .env
```

Open `.env` and fill in:

```
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/foundry?retryWrites=true&w=majority
JWT_SECRET=generate_a_long_random_string_here
JWT_EXPIRES_IN=7d
CLIENT_ORIGIN=http://localhost:5500
```

Generate a strong secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Never commit `.env` to GitHub. `.gitignore` already excludes it.

### Step 5 — Seed demo data

```bash
npm run seed
```

This creates 3 users and 12 sample listings:

| Role | Email | Password |
|---|---|---|
| Admin | admin@saiuniversity.edu.in | admin123 |
| Student | student@saiuniversity.edu.in | student123 |
| Student | priya@saiuniversity.edu.in | priya123 |

### Step 6 — Run the server

```bash
npm start
```

You should see:

```
MongoDB Connected: cluster0.xxxxx.mongodb.net
Server running on http://localhost:5000
```

Check it: open http://localhost:5000/api/health

---

## 5. API endpoints

Base URL: `http://localhost:5000`

### Authentication
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create a student account |
| POST | `/api/auth/login` | Public | Log in, returns a JWT |
| GET | `/api/auth/me` | Protected | Current user from token |
| POST | `/api/auth/logout` | Protected | Confirm logout |

### Items
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/api/items` | Public | List with search, filters, sort, paging |
| GET | `/api/items/meta` | Public | Categories and locations for dropdowns |
| GET | `/api/items/:id` | Public | Single listing |
| GET | `/api/items/:id/similar` | Public | Duplicate-item alert |
| POST | `/api/items` | Protected | Create a lost/found report |
| PUT | `/api/items/:id` | Owner/Admin | Edit a listing |
| PATCH | `/api/items/:id/status` | Owner/Admin | Mark claimed/returned/closed |
| DELETE | `/api/items/:id` | Owner/Admin | Delete a listing |

### Claims
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/claims` | Protected | Submit a claim |
| GET | `/api/claims/mine` | Protected | Claims I have made |
| GET | `/api/claims/item/:itemId` | Owner/Admin | Claims on my listing |
| PATCH | `/api/claims/:id` | Owner/Admin | Approve or reject a claim |

### Dashboards
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/api/dashboard/me` | Protected | My listings, claims and counters |
| GET | `/api/admin/stats` | Admin | Totals and chart groupings |
| GET | `/api/admin/items` | Admin | All listings |
| GET | `/api/admin/claims` | Admin | All claims |
| GET | `/api/admin/users` | Admin | All users |
| PATCH | `/api/admin/items/:id/status` | Admin | Force a status change |
| GET | `/api/leaderboard` | Public | Top students by points |

### Search query parameters

```
GET /api/items?q=bottle&category=Bottles&location=Canteen&type=found&status=open&sort=newest&page=1&limit=20
```

- `q` — keyword in title or description
- `category`, `location`, `type`, `status` — filters, or `all`
- `sort` — `newest`, `oldest`, `title`, `title-desc`
- `page`, `limit` — pagination

---

## 6. Testing

### Automated tests

```bash
# Checks that need no database (routes, schemas, hashing, tokens)
node test/offline.test.js

# Full API tests against a throwaway in-memory MongoDB
npm test

# Or point the suite at your own MongoDB
MONGO_URI=mongodb://localhost:27017/foundry_test npm test
```

### Postman

1. Open Postman → *Import* → `backend/postman/Foundry.postman_collection.json`
2. Run **Auth → Login (student)** and **Auth → Login (admin)** first — they save the tokens into collection variables automatically
3. Run the rest of the folders in order
4. Use *Run collection* for a full pass with a results summary

The collection covers the required cases: successful requests, invalid input, item retrieval, updates, claim submission, and unauthorized access.

---

## 7. Deployment (Render)

1. Push the project to a **public GitHub repository**
2. Sign up at https://render.com with GitHub
3. *New → Web Service* → select the repository
4. Configure:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Free
5. Add environment variables under *Environment*:
   - `MONGO_URI` — your Atlas string
   - `JWT_SECRET` — a long random string
   - `JWT_EXPIRES_IN` — `7d`
   - `NODE_ENV` — `production`
   - `CLIENT_ORIGIN` — your deployed frontend URL
6. Deploy. Render gives you a URL like `https://foundry-api.onrender.com`
7. In Atlas, confirm Network Access allows `0.0.0.0/0`
8. Verify: open `https://your-url.onrender.com/api/health`

**Important:** the free tier sleeps after inactivity, so the first request can take ~30 seconds to wake up.

---

## 8. Security notes

- Passwords are hashed with bcrypt and never returned by any endpoint
- JWTs are required on all write operations
- Ownership checks prevent editing or deleting another user's listing
- Role checks prevent students from reading admin endpoints
- `helmet` sets security headers; CORS is restricted in production
- Login and register are rate-limited to slow brute-force attempts
- Reporter email addresses are never exposed in public item responses

---

## 9. Honest limitations

This is an academic project, not a production system:

- Email verification and password reset are not implemented
- Images are stored as a URL or a small base64 string, not uploaded to object storage
- Logout is client-side because JWTs are stateless; there is no token blocklist
- No email or WhatsApp notifications are sent — any such UI is a placeholder
- The claim workflow is manual review by the item owner or an admin

---

## 10. AI use disclosure

AI assistance was used during development for scaffolding and debugging. All code was reviewed, tested and understood before submission, as required by the project guidelines.
