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
 * TLS settings for the database connection.
 *
 * Supabase's pooler presents a chain signed by Supabase's own CA, which Node's
 * bundled trust store does not contain — connecting with the default settings
 * fails with "self-signed certificate in certificate chain".
 *
 * Three modes, in order of preference:
 *
 *   1. PG_CA_CERT_PATH — path to Supabase's prod-ca-2021.crt (Settings ->
 *      Database -> SSL Configuration). Full verification, nothing weakened.
 *   2. PG_SSL_NO_VERIFY=true — accept the chain without verifying it. Works
 *      immediately, but a machine in the middle could impersonate the database.
 *      Use it to unblock, not as the permanent answer.
 *   3. Default — verify. Correct, and fails loudly until 1 or 2 is configured.
 */
const sslConfig = () => {
  if (process.env.PG_NO_SSL === 'true') return false;

  const caPath = process.env.PG_CA_CERT_PATH;
  if (caPath) {
    try {
      const fs = require('fs');
      const ca = fs.readFileSync(caPath, 'utf8');
      console.log(`PostgreSQL TLS: verifying against ${caPath}`);
      return { ca, rejectUnauthorized: true };
    } catch (err) {
      console.error(`PG_CA_CERT_PATH is set but unreadable (${err.message}); falling through`);
    }
  }

  if (process.env.PG_SSL_NO_VERIFY === 'true') {
    console.warn(
      'WARNING: PG_SSL_NO_VERIFY is set — the database TLS certificate is NOT verified. ' +
      'This accepts any certificate the server presents. Set PG_CA_CERT_PATH to ' +
      'Supabase prod-ca-2021.crt to restore verification.'
    );
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: true };
};

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
    connectionString: connectTarget,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: sslConfig()
  });

  // A pool error must never crash the process silently.
  pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
  });

  // pg-connection-string lets an `sslmode` parameter in the URL override the
  // explicit `ssl` option we pass to the Pool. That silently defeats the TLS
  // settings above: ?sslmode=disable gives plaintext, ?sslmode=no-verify drops
  // verification, and ?sslmode=require discards the CA from PG_CA_CERT_PATH.
  // Strip it so sslConfig() is authoritative.
  let connectTarget = connectionString;
  try {
    const parsed = new URL(connectionString);
    if (parsed.searchParams.has('sslmode')) {
      console.warn(
        'WARNING: sslmode in DATABASE_URL was ignored — TLS is controlled by ' +
        'PG_CA_CERT_PATH / PG_SSL_NO_VERIFY instead. Remove sslmode to avoid confusion.'
      );
      parsed.searchParams.delete('sslmode');
      connectTarget = parsed.toString();
    }
  } catch { /* an unparseable URL will fail at connect anyway */ }

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
