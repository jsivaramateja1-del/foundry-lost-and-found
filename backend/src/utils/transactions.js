const mongoose = require('mongoose');

/**
 * Do transactions work on this connection?
 *
 * MongoDB only supports multi-document transactions on a replica set or a
 * sharded cluster. Atlas always is one; a standalone server (including the
 * in-memory server used by `npm test` on a laptop) is not, and attempting one
 * throws. The answer is cached, and the caller falls back to a compensating
 * write path when it is false.
 */
let cached = null;

const supportsTransactions = async () => {
  if (cached !== null) return cached;
  try {
    if (mongoose.connection.readyState !== 1) {
      // Not connected yet. Deliberately NOT cached: a probe made before the
      // connection finishes would otherwise disable transactions for the whole
      // process, silently downgrading every approval to the fallback path.
      return false;
    }
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    cached = Boolean(info.setName) || info.msg === 'isdbgrid';
  } catch {
    cached = false;
  }
  return cached;
};

/** Reset the cache — used by the tests. */
const forgetTransactionSupport = () => { cached = null; };

module.exports = { supportsTransactions, forgetTransactionSupport };
