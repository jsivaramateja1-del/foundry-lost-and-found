/**
 * PostgreSQL connection (Supabase).
 *
 * Uses node-postgres directly rather than the supabase-js client: the claim,
 * handover and points-ledger paths need real transactions with row locks, and
 * PostgREST cannot express a multi-statement transaction.
 *
 * DATABASE_URL should be the Supabase "Connection pooling" string (port 6543,
 * pgbouncer) for the app, and the direct string (port 5432) for migrations.
 * Never commit either.
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
