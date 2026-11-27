const { Pool } = require('pg');

let pool = null;

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

const connectDB = async (connectionString = process.env.DATABASE_URL) => {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  if (pool) return pool;

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
  } catch {  }

  pool = new Pool({
    connectionString: connectTarget,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: sslConfig()
  });

  pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
  });

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
  } catch {  }

  const { rows } = await pool.query('select current_database() as db, inet_server_addr() as host');
  console.log(`PostgreSQL Connected: host=${rows[0].host || 'pooler'} database=${rows[0].db}`);
  return pool;
};

const db = () => {
  if (!pool) throw new Error('Database not connected. Call connectDB() first.');
  return pool;
};

const one = async (text, params) => (await db().query(text, params)).rows[0];

const many = async (text, params) => (await db().query(text, params)).rows;

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

const resolveConnection = (connectionString, env = process.env) => {
  const warnings = [];
  let connectTarget = connectionString;

  try {
    const parsed = new URL(connectionString);
    if (parsed.searchParams.has('sslmode')) {
      warnings.push('sslmode-ignored');
      parsed.searchParams.delete('sslmode');
      connectTarget = parsed.toString();
    }
    if (/\.supabase\.co$/i.test(parsed.hostname) && parsed.port === '5432') {
      warnings.push('direct-host');
    }
  } catch {  }

  let ssl;
  if (env.PG_NO_SSL === 'true') {
    ssl = false;
  } else if (env.PG_CA_CERT_PATH) {
    try {
      ssl = { ca: require('fs').readFileSync(env.PG_CA_CERT_PATH, 'utf8'), rejectUnauthorized: true };
    } catch {
      warnings.push('ca-unreadable');
      ssl = env.PG_SSL_NO_VERIFY === 'true'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true };
    }
  } else if (env.PG_SSL_NO_VERIFY === 'true') {
    warnings.push('no-verify');
    ssl = { rejectUnauthorized: false };
  } else {
    ssl = { rejectUnauthorized: true };
  }

  return { connectTarget, ssl, warnings };
};

module.exports.resolveConnection = resolveConnection;
