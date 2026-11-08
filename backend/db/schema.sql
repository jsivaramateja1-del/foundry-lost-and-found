-- ============================================================
-- Foundry — Supabase (PostgreSQL) schema
--
-- Replaces the eight Mongoose models. Run this in the Supabase
-- SQL editor, or via `psql "$DATABASE_URL" -f db/schema.sql`.
--
-- Design notes
--  * UUID primary keys replace ObjectId. gen_random_uuid() is
--    built into Postgres 13+ (pgcrypto not required on Supabase).
--  * Enumerations are CHECK constraints rather than ENUM types:
--    adding a value later is a one-line ALTER, and the error
--    message names the offending value, which ENUM does not.
--  * The old User.creditedEvents array existed to make point
--    awards idempotent. A UNIQUE(user_id, event_key) constraint
--    on point_events does the same job in the database, with no
--    unbounded growth. That whole class of bug disappears.
--  * Every foreign key declares its delete behaviour explicitly.
--    Nothing cascades into users: deleting an account is a
--    deliberate act, not a side effect.
-- ============================================================

-- ---------- users ----------
CREATE TABLE IF NOT EXISTS users (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      TEXT        NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  email                     TEXT        NOT NULL,
  password                  TEXT        NOT NULL,
  role                      TEXT        NOT NULL DEFAULT 'student'
                            CHECK (role IN ('student','faculty','moderator','admin','superadmin')),
  points                    INTEGER     NOT NULL DEFAULT 0 CHECK (points >= 0),
  returns                   INTEGER     NOT NULL DEFAULT 0 CHECK (returns >= 0),
  leaderboard_opt_out       BOOLEAN     NOT NULL DEFAULT false,
  email_verified            BOOLEAN     NOT NULL DEFAULT false,
  pending_approval          BOOLEAN     NOT NULL DEFAULT false,
  approval_note             TEXT        NOT NULL DEFAULT '',
  suspended                 BOOLEAN     NOT NULL DEFAULT false,
  suspended_reason          TEXT        NOT NULL DEFAULT '',
  suspended_at              TIMESTAMPTZ,
  suspended_until           TIMESTAMPTZ,
  verification_token_hash   TEXT,
  verification_token_expires TIMESTAMPTZ,
  reset_token_hash          TEXT,
  reset_token_expires       TIMESTAMPTZ,
  token_version             INTEGER     NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: the app lowercases on write, and this
-- guarantees it even if some future path forgets.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
CREATE INDEX IF NOT EXISTS users_leaderboard_idx
  ON users (points DESC, returns DESC) WHERE role = 'student' AND leaderboard_opt_out = false;

-- ---------- items ----------
CREATE TABLE IF NOT EXISTS items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT        NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 120),
  description      TEXT        NOT NULL DEFAULT '',
  category         TEXT        NOT NULL
                   CHECK (category IN ('Electronics','IDs & Cards','Bags','Books & Notes',
                                       'Bottles','Keys & Accessories','Clothing','Other')),
  subcategory      TEXT        NOT NULL DEFAULT '',
  custom_category  TEXT        NOT NULL DEFAULT '',
  location         TEXT        NOT NULL
                   CHECK (location IN ('Library','Main Block','Canteen','Hostel A','Hostel B',
                                       'Sports Complex','Auditorium','Parking','Other')),
  custom_location  TEXT        NOT NULL DEFAULT '',
  date             DATE        NOT NULL,
  type             TEXT        NOT NULL CHECK (type IN ('lost','found')),
  status           TEXT        NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','claimed','returned','hidden')),
  image_url        TEXT        NOT NULL DEFAULT '',
  verified_at      TIMESTAMPTZ,
  verified_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_by      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_board_idx    ON items (status, type, created_at DESC);
CREATE INDEX IF NOT EXISTS items_category_idx ON items (category, type);
CREATE INDEX IF NOT EXISTS items_location_idx ON items (location);
CREATE INDEX IF NOT EXISTS items_reporter_idx ON items (reported_by);
CREATE INDEX IF NOT EXISTS items_date_idx     ON items (date DESC);
-- Replaces the Mongo text index on title+description.
CREATE INDEX IF NOT EXISTS items_search_idx
  ON items USING GIN (to_tsvector('simple', title || ' ' || description));

-- ---------- claims ----------
CREATE TABLE IF NOT EXISTS claims (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item                    UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  claimant                UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message                 TEXT        NOT NULL DEFAULT '',
  status                  TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','completed')),
  reviewed_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note             TEXT        NOT NULL DEFAULT '',
  reviewed_at             TIMESTAMPTZ,
  handover_confirmed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  handover_confirmed_at   TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One claim per (item, claimant) — the Mongo unique index, now enforced.
CREATE UNIQUE INDEX IF NOT EXISTS claims_item_claimant_uniq ON claims (item, claimant);
CREATE INDEX IF NOT EXISTS claims_item_status_idx ON claims (item, status);
CREATE INDEX IF NOT EXISTS claims_claimant_idx    ON claims (claimant);

-- ---------- notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT        NOT NULL DEFAULT 'info',
  message       TEXT        NOT NULL,
  link          TEXT        NOT NULL DEFAULT '',
  related_type  TEXT        NOT NULL DEFAULT '',
  related_id    TEXT        NOT NULL DEFAULT '',
  read          BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

-- ---------- point_events (the ledger) ----------
CREATE TABLE IF NOT EXISTS point_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN ('return','found_item')),
  points      INTEGER     NOT NULL CHECK (points > 0),
  event_key   TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','claimed','completed')),
  claimed_at  TIMESTAMPTZ,
  item        UUID REFERENCES items(id) ON DELETE SET NULL,
  claim       UUID REFERENCES claims(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE idempotency guarantee. A second insert for the same event_key is a
-- no-op, so an award can never be credited twice — no marker array needed.
CREATE UNIQUE INDEX IF NOT EXISTS point_events_idem_uniq ON point_events (user_id, event_key);
CREATE INDEX IF NOT EXISTS point_events_user_idx   ON point_events (user_id, status);
CREATE INDEX IF NOT EXISTS point_events_status_idx ON point_events (status, created_at);

-- ---------- reports ----------
CREATE TABLE IF NOT EXISTS reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item             UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reported_by      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason           TEXT        NOT NULL CHECK (reason IN ('spam','inappropriate','fake','other')),
  details          TEXT        NOT NULL DEFAULT '',
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','reviewed','dismissed','actioned')),
  reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  resolution_note  TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_item_idx   ON reports (item);

-- ---------- audit_logs ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor        UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email  TEXT        NOT NULL DEFAULT '',
  action       TEXT        NOT NULL,
  target_type  TEXT        NOT NULL DEFAULT '',
  target_id    TEXT        NOT NULL DEFAULT '',
  note         TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx   ON audit_logs (actor);

-- ---------- campus_locations ----------
CREATE TABLE IF NOT EXISTS campus_locations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  kind         TEXT        NOT NULL DEFAULT 'building'
               CHECK (kind IN ('building','gate','facility','landmark')),
  description  TEXT        NOT NULL DEFAULT '',
  lat          DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  source       TEXT        NOT NULL DEFAULT '',
  source_url   TEXT        NOT NULL DEFAULT '',
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campus_locations_name_uniq ON campus_locations (lower(name));

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','items','claims'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I_touch ON %I; CREATE TRIGGER %I_touch
       BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at();',
      t, t, t, t);
  END LOOP;
END $$;
