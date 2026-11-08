/**
 * Compares each user's stored totals against the points ledger.
 *
 * The ledger is the source of truth: point_events has a unique
 * (user_id, event_key), so its sum is what the user actually earned. If
 * users.points has drifted — an interrupted write, a hand-edited row — this
 * finds it.
 *
 *   npm run reconcile:points            report only, changes nothing
 *   npm run reconcile:points -- --apply repair the drifted rows
 *
 * Repairs write an audit_logs row, so a correction is attributable.
 */
require('dotenv').config();
const { connectDB, many, one, closeDB } = require('../src/config/pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  try {
    await connectDB();

    const rows = await many(`
      select u.id, u.email, u.points, u.returns,
             coalesce(sum(pe.points) filter (where pe.status = 'completed'), 0)::int as ledger_points,
             count(pe.id) filter (where pe.type = 'return' and pe.status = 'completed')::int as ledger_returns,
             count(pe.id) filter (where pe.status in ('pending','claimed'))::int as pending_events
        from users u
        left join point_events pe on pe.user_id = u.id
       group by u.id, u.email, u.points, u.returns
       order by u.email`);

    const drifted = rows.filter((r) => r.points !== r.ledger_points || r.returns !== r.ledger_returns);

    console.log(`Checked ${rows.length} account(s).`);
    if (!drifted.length) {
      console.log('All accounts agree with the ledger. Nothing to do.');
      return;
    }

    console.log(`\n${drifted.length} account(s) disagree with the ledger:\n`);
    for (const r of drifted) {
      console.log(`  ${r.email}`);
      console.log(`    points   stored ${r.points}   ledger ${r.ledger_points}`);
      console.log(`    returns  stored ${r.returns}   ledger ${r.ledger_returns}`);
      if (r.pending_events) console.log(`    (${r.pending_events} pending event(s) not counted)`);
    }

    if (!APPLY) {
      console.log('\nReport only. Re-run with --apply to correct these rows.');
      return;
    }

    for (const r of drifted) {
      await one(
        'update users set points = $2, returns = $3 where id = $1',
        [r.id, r.ledger_points, r.ledger_returns]);
      await one(
        `insert into audit_logs (actor_email, action, target_type, target_id, note)
         values ($1,'points.reconciled','user',$2,$3)`,
        ['reconcile-points', r.id,
         `points ${r.points} -> ${r.ledger_points}; returns ${r.returns} -> ${r.ledger_returns}`]);
      console.log(`  corrected ${r.email}`);
    }
    console.log(`\nCorrected ${drifted.length} account(s).`);
  } catch (err) {
    console.error('Reconciliation failed:', err.message);
    process.exitCode = 1;
  } finally {
    await closeDB().catch(() => {});
  }
})();
