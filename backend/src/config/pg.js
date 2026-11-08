/**
 * PostgreSQL connection (Supabase).
 *
 * Uses node-postgres directly rather than the supabase-js client: the claim,
 * handover and points-ledger paths need real transactions with row locks, and
 * PostgREST cannot express a multi-statement transaction.
 *
 * DATABASE_URL MUST be Supabase's shared pooler string for anything running on
 * Render:
 *
 *   postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-<N>-<REGION>.pooler.supabase.com:6543/postgres
 *
 * Why this matters: Supabase's direct connection (db.<ref>.supabase.co, port
 * 5432) resolves to an IPv6 address on the free plan, and Render does not
 * support outbound IPv6. Using the direct string from Render fails with
 * ENETUNREACH — which looks like bad credentials but is a routing problem.
 * The shared pooler is IPv4-only on every plan, so it works.
 *
 *   Web service / cron  -> pooler, transaction mode, port 6543
 *   Long-lived worker   -> pooler, session mode, port 5432
 *   Migrations / pg_dump -> direct connection, from a machine with IPv6
 *
 * Never commit any of these strings.
 */
const { Pool } = require('pg');

let pool = null;

/**
 * Opens the pool and proves the connection works. Mirrors connectDB(): it
 * throws rather than returning a dead handle, so startup fails loudly.
 */
const connectDB = async (connectionString = process.env.DATABASE_URL) => {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  if (pool) return pool;

  pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // Supabase requires TLS; the pooler presents a certificate the default
    // trust store validates, so no `rejectUnauthorized: false` is needed.
    ssl: process.env.PG_NO_SSL === 'true' ? false : { rejectUnauthorized: true }
  });

  // A pool error must never crash the process silently.
  pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
  });

  // Catch the IPv6 trap before it produces an unexplained failure.
  try {
    const parsed = new URL(connectionString);
    if (/\.supabase\.co$/i.test(parsed.hostname) && parsed.port === '5432') {
      console.warn(
        'WARNING: DATABASE_URL points at the Supabase DIRECT host on port 5432. ' +
        'That endpoint is IPv6-only on the free plan and Render has no outbound IPv6, ' +
        'so connections will fail with ENETUNREACH. Use the shared pooler string ' +
        '(aws-<n>-<region>.pooler.supabase.com:6543) instead.'
      );
    }
  } catch { /* an unparseable URL will fail at connect anyway */ }

  const { rows } = await pool.query('select current_database() as db, inet_server_addr() as host');
  console.log(`PostgreSQL Connected: host=${rows[0].host || 'pooler'} database=${rows[0].db}`);
  return pool;
};

/** The pool, or a clear error if connectDB() was never called. */
const db = () => {
  if (!pool) throw new Error('Database not connected. Call connectDB() first.');
  return pool;
};

/** Single-row helper: returns the row, or undefined. */
const one = async (text, params) => (await db().query(text, params)).rows[0];

/** Multi-row helper. */
const many = async (text, params) => (await db().query(text, params)).rows;

/**
 * Runs `fn` inside a transaction with a dedicated client, rolling back on any
 * throw. This is the replacement for Mongoose sessions and is what the claim
 * approval and handover paths will use.
 */
const transaction = async (fn) => {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const closeDB = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = { connectDB, db, one, many, transaction, closeDB };
