/**
 * The remaining PostgreSQL routers: notifications, dashboard, leaderboard,
 * campus locations, reports and the admin surface.
 */
const express = require('express');
const { one, many } = require('../config/pg');
const items = require('../repositories/items');
const points = require('../repositories/points');
const users = require('../repositories/users');
const { protect, requireRole } = require('../middleware/auth.v2');
const mailer = require('../lib/brevo');
const notify = require('../repositories/notify');
const badges = require('../repositories/badges');

const appUrl = () => (process.env.APP_URL || 'http://localhost:5000').replace(/\/+$/, '');

// ---------- notifications ----------
const notifications = express.Router();

notifications.get('/', protect, async (req, res, next) => {
  try {
    const rows = (await many(
      `select id, type, message, link, read, created_at from notifications
        where user_id = $1 order by created_at desc limit 50`, [req.user.id]))
      .map((n) => ({ ...n, createdAt: n.created_at }));
    const unread = await one(
      'select count(*)::int as n from notifications where user_id=$1 and read=false', [req.user.id]);
    res.status(200).json({ notifications: rows, unread: unread.n });
  } catch (err) { next(err); }
});

// Must be declared BEFORE /:id/read or 'read-all' is captured as an id.
notifications.patch('/read-all', protect, async (req, res, next) => {
  try {
    const { db } = require('../config/pg');
    const r = await db().query(
      `update notifications set read = true
        where user_id = $1 and read = false`, [req.user.id]);
    res.status(200).json({ updated: r.rowCount, message: 'All notifications marked read' });
  } catch (err) { next(err); }
});

notifications.patch('/:id/read', protect, async (req, res, next) => {
  try {
    const row = await one(
      `update notifications set read = true
        where id = $1 and user_id = $2 returning id`, [req.params.id, req.user.id]);
    if (!row) return res.status(404).json({ message: 'Notification not found' });
    res.status(200).json({ message: 'Marked as read' });
  } catch (err) { next(err); }
});

// ---------- dashboard ----------
const dashboard = express.Router();

dashboard.get('/me', protect, async (req, res, next) => {
  try {
    const mine = await items.list({ reportedBy: req.user.id, includeHidden: true }, { limit: 50 });
    const ledger = await points.forUser(req.user.id, 20);
    const audit = await points.auditUser(req.user.id);
    const unread = await one(
      'select count(*)::int as n from notifications where user_id=$1 and read=false', [req.user.id]);
    const claimsMade = await many(
      `select c.id, c.item, c.claimant, c.status, c.message, c.created_at, i.title as item_title
         from claims c join items i on i.id = c.item
        where c.claimant = $1 order by c.created_at desc limit 50`, [req.user.id]);
    const claimsReceived = await many(
      `select c.id, c.item, c.claimant, c.status, c.message, c.created_at, u.name as claimant_name
         from claims c join items i on i.id = c.item join users u on u.id = c.claimant
        where i.reported_by = $1 order by c.created_at desc limit 50`, [req.user.id]);

    const count = (st) => mine.items.filter((i) => i.status === st).length;
    // `stats`, `impact`, `badges`, `items` and `claims` are the names the
    // dashboard reads. Badges are not implemented yet, so the array is empty
    // rather than missing — a missing key throws in the page.
    res.status(200).json({
      user: users.toSafeObject(req.user),
      stats: {
        listings: mine.items.length,
        lost: mine.items.filter((i) => i.type === 'lost').length,
        found: mine.items.filter((i) => i.type === 'found').length,
        open: count('open'), claimed: count('claimed'), returned: count('returned'),
        claimsMade: claimsMade.length,
        claimsReceived: claimsReceived.length,
        pendingClaims: claimsReceived.filter((c) => c.status === 'pending').length,
        points: req.user.points, returns: req.user.returns
      },
      impact: { points: req.user.points, returns: req.user.returns,
                contributions: mine.items.length },
      badges: await badges.forUser(req.user.id),
      items: mine.items,
      claims: claimsMade.map((c) => ({
        ...c, itemTitle: c.item_title, createdAt: c.created_at,
        item: { id: c.item, title: c.item_title }
      })),
      claimsReceived: claimsReceived.map((c) => ({
        ...c, claimantName: c.claimant_name, createdAt: c.created_at,
        claimant: { id: c.claimant, name: c.claimant_name }
      })),
      listings: mine.items,
      ledger, pointsAudit: audit, unreadNotifications: unread.n
    });
  } catch (err) { next(err); }
});

// ---------- leaderboard ----------
const leaderboard = express.Router();

leaderboard.get('/', async (req, res, next) => {
  try {
    const period = String(req.query.period || 'all').toLowerCase();
    if (!['week','month','all'].includes(period)) {
      return res.status(400).json({ message: 'period must be one of: week, month, all' });
    }
    const rows = await points.leaderboard(period);
    // The frontend reads `leaderboard` and `rank`; keep those names and expose
    // `position` too so either spelling works.
    res.status(200).json({
      period,
      count: rows.length,
      leaderboard: rows.map((r) => ({ ...r, rank: r.position }))
    });
  } catch (err) { next(err); }
});

// ---------- campus ----------
const campus = express.Router();

campus.get('/locations', async (req, res, next) => {
  try {
    const rows = await many(
      'select id, name, kind, description, lat, lng, source, source_url from campus_locations order by name');
    res.status(200).json({
      count: rows.length,
      locations: rows.map((l) => ({
        id: l.id, name: l.name, kind: l.kind, description: l.description,
        lat: l.lat, lng: l.lng, source: l.source, sourceUrl: l.source_url,
        verified: Boolean(l.source_url)
      }))
    });
  } catch (err) { next(err); }
});

campus.post('/locations', protect, requireRole('admin','superadmin'), async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const source = typeof req.body.source === 'string' ? req.body.source.trim() : '';
    const sourceUrl = typeof req.body.sourceUrl === 'string' ? req.body.sourceUrl.trim() : '';
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (name.length < 2) return res.status(400).json({ message: 'name is required' });
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return res.status(400).json({ message: 'lat is out of range' });
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return res.status(400).json({ message: 'lng is out of range' });
    if (source.length < 3) return res.status(400).json({ message: 'source is required' });
    if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) {
      return res.status(400).json({ message: 'sourceUrl must be an http(s) link' });
    }

    try {
      const row = await one(
        `insert into campus_locations (name, kind, description, lat, lng, source, source_url, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [name, typeof req.body.kind === 'string' ? req.body.kind : 'building',
         typeof req.body.description === 'string' ? req.body.description : '',
         lat, lng, source, sourceUrl, req.user.id]);
      res.status(201).json({ location: { ...row, verified: Boolean(row.source_url) } });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ message: 'A location with that name already exists' });
      throw err;
    }
  } catch (err) { next(err); }
});

// ---------- reports ----------
const reports = express.Router();

reports.post('/', protect, async (req, res, next) => {
  try {
    const itemId = typeof req.body.item === 'string' ? req.body.item : '';
    const reason = typeof req.body.reason === 'string' ? req.body.reason : '';
    // Must cover every option the report form offers, or two of them 400.
    if (!['spam','inappropriate','suspicious','incorrect','fake','other'].includes(reason)) {
      return res.status(400).json({ message: 'Unknown report reason' });
    }
    const item = await items.findById(itemId);
    if (!item) return res.status(404).json({ message: 'Listing not found' });

    await one(
      `insert into reports (item, reported_by, reason, details) values ($1,$2,$3,$4) returning id`,
      [item.id, req.user.id, reason, typeof req.body.details === 'string' ? req.body.details.slice(0, 500) : '']);
    res.status(201).json({ message: 'Thank you — a moderator will look at this.' });
  } catch (err) { next(err); }
});

reports.get('/', protect, requireRole('moderator','admin','superadmin'), async (req, res, next) => {
  try {
    const rows = await many(
      `select r.*, i.title as item_title from reports r join items i on i.id = r.item
        where r.status = 'pending' order by r.created_at desc limit 50`);
    res.status(200).json({ reports: rows });
  } catch (err) { next(err); }
});

// ---------- admin ----------
const admin = express.Router();

const STAFF = ['moderator', 'admin', 'superadmin'];
const pageOf = (q) => Math.max(1, parseInt(q.page, 10) || 1);
const limitOf = (q, d = 12) => Math.min(100, Math.max(1, parseInt(q.limit, 10) || d));

/** GET /api/admin/stats — totals, by category, and the last 7 days. */
admin.get('/stats', protect, requireRole(...STAFF), async (req, res, next) => {
  try {
    const totals = await one(`
      select
        (select count(*) from items)::int as items,
        (select count(*) from items where type='lost')::int as lost,
        (select count(*) from items where type='found')::int as found,
        (select count(*) from items where status='open')::int as open,
        (select count(*) from items where status='claimed')::int as claimed,
        (select count(*) from items where status='returned')::int as returned,
        (select count(*) from items where status='hidden')::int as hidden,
        (select count(*) from users)::int as users,
        (select count(*) from users where suspended)::int as suspendedUsers,
        (select count(*) from users where pending_approval)::int as pendingUsers,
        (select count(*) from claims)::int as claims,
        (select count(*) from claims where status='pending')::int as pendingClaims,
        (select count(*) from reports where status='pending')::int as openReports`);

    const byCategory = await many(
      `select category, count(*)::int as count from items
        where status <> 'hidden' group by category order by count desc`);

    const perDay = await many(`
      select to_char(d.day, 'YYYY-MM-DD') as date, count(i.id)::int as count
        from generate_series(current_date - interval '6 days', current_date, interval '1 day') d(day)
        left join items i on i.created_at::date = d.day
       group by d.day order by d.day`);

    const byStatus = await many(
      `select status, count(*)::int as count from items group by status order by status`);
    res.status(200).json({ totals, byStatus, byCategory, perDay });
  } catch (err) { next(err); }
});

/** GET /api/admin/items — every listing, hidden included. */
admin.get('/items', protect, requireRole(...STAFF), async (req, res, next) => {
  try {
    const page = pageOf(req.query), limit = limitOf(req.query);
    const params = [];
    const clauses = [];
    // Moderators work the verification queue, so they see found items only.
    if (req.user.role === 'moderator') clauses.push("i.type = 'found'");
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';

    const total = (await one(`select count(*)::int as n from items i ${where}`, params)).n;
    const rows = await many(
      `select i.*, r.name as reporter_name, v.name as verifier_name
         from items i
         left join users r on r.id = i.reported_by
         left join users v on v.id = i.verified_by
         ${where}
        order by i.created_at desc
        limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]);

    res.status(200).json({
      count: rows.length, total, page, pages: Math.ceil(total / limit) || 1,
      items: rows.map((r) => ({
        ...items.toItem(r),
        // The admin table renders nested names, not bare uuids.
        reportedBy: { id: r.reported_by, name: r.reporter_name },
        verifiedBy: r.verified_by ? { id: r.verified_by, name: r.verifier_name } : null
      }))
    });
  } catch (err) { next(err); }
});

/** GET /api/admin/claims */
// Admin-only: a moderator has no reason to read every claim and claimant name
// on the platform, and the pre-migration rule restricted it the same way.
admin.get('/claims', protect, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const page = pageOf(req.query), limit = limitOf(req.query);
    const total = (await one('select count(*)::int as n from claims')).n;
    const rows = await many(
      `select c.*, i.title as item_title, u.name as claimant_name
         from claims c
         join items i on i.id = c.item
         join users u on u.id = c.claimant
        order by c.created_at desc limit $1 offset $2`, [limit, (page - 1) * limit]);
    res.status(200).json({
      count: rows.length, total, page, pages: Math.ceil(total / limit) || 1,
      claims: rows.map((c) => ({
        id: c.id, message: c.message, status: c.status, createdAt: c.created_at,
        item: { id: c.item, title: c.item_title },
        claimant: { id: c.claimant, name: c.claimant_name }
      }))
    });
  } catch (err) { next(err); }
});

/** GET /api/admin/reports */
admin.get('/reports', protect, requireRole(...STAFF), async (req, res, next) => {
  try {
    const rows = await many(
      `select r.*, i.title as item_title, u.name as reporter_name
         from reports r
         join items i on i.id = r.item
         left join users u on u.id = r.reported_by
        where r.status = 'pending'
        order by r.created_at desc limit 100`);
    res.status(200).json({
      count: rows.length,
      reports: rows.map((r) => ({
        id: r.id, reason: r.reason, details: r.details,
        // The page tests for 'open'; the schema calls it 'pending'.
        status: r.status === 'pending' ? 'open' : r.status,
        createdAt: r.created_at,
        item: { id: r.item, title: r.item_title },
        reportedBy: { id: r.reported_by, name: r.reporter_name }
      }))
    });
  } catch (err) { next(err); }
});

/** GET /api/admin/audit */
admin.get('/audit', protect, requireRole(...STAFF), async (req, res, next) => {
  try {
    const rows = await notify.trail(50);
    res.status(200).json({
      count: rows.length,
      entries: rows.map((r) => ({
        action: r.action, actor: r.actor_email, note: r.note, createdAt: r.created_at
      }))
    });
  } catch (err) { next(err); }
});

/** PATCH /api/admin/items/:id/verify — verifying a found listing earns points. */
admin.patch('/items/:id/verify', protect, requireRole(...STAFF), async (req, res, next) => {
  try {
    const item = await items.findByIdRaw(req.params.id);
    if (!item) return res.status(404).json({ message: 'Listing not found' });
    if (item.type !== 'found') {
      return res.status(400).json({ message: 'Only found listings can be verified' });
    }
    if (item.verifiedAt) {
      return res.status(409).json({ message: 'That listing is already verified' });
    }
    if (item.status === 'hidden') {
      return res.status(409).json({ message: 'Restore the listing before verifying it' });
    }
    // A moderator must not verify their own listing: that is unbounded point
    // farming, and it contradicts the self-dealing rule on the status route.
    if (req.user.role === 'moderator' && item.reportedBy === req.user.id) {
      return res.status(403).json({ message: 'A moderator cannot verify their own listing' });
    }

    const verified = await items.verify(item.id, req.user.id);
    await points.awardOnce({
      userId: item.reportedBy, type: 'found_item',
      eventKey: `found:${item.id}`, itemId: item.id
    });

    notify.create(null, {
      userId: item.reportedBy, type: 'item_verified',
      message: `Your found listing "${item.title}" was verified.`,
      link: 'dashboard.html', relatedType: 'item', relatedId: item.id
    }).catch(() => {});
    await notify.audit({
      actor: req.user.id, actorEmail: req.user.email,
      action: 'item.verify', targetType: 'item', targetId: item.id, note: item.title
    });

    // Award any badge the reporter now qualifies for, and say so.
    const earned = await badges.evaluate(null, item.reportedBy);
    if (earned.length) {
      const names = badges.BADGES.filter((b) => earned.includes(b.id)).map((b) => b.label);
      notify.create(null, {
        userId: item.reportedBy, type: 'badge_earned',
        message: `You earned a badge: ${names.join(', ')}`,
        link: 'dashboard.html', relatedType: 'item', relatedId: item.id
      }).catch(() => {});
    }

    const reporter = await users.findById(item.reportedBy);
    if (reporter) {
      mailer.send('itemVerified', reporter.email, {
        name: reporter.name, title: item.title, link: `${appUrl()}/index.html`
      }).catch(() => {});
    }
    res.status(200).json({ item: verified });
  } catch (err) { next(err); }
});

/** PATCH /api/admin/items/:id/status — staff may set any lifecycle state. */
admin.patch('/items/:id/status', protect, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const requested = typeof req.body.status === 'string' ? req.body.status.trim() : '';
    const next_ = requested === 'closed' ? 'hidden' : requested;
    if (!['open', 'claimed', 'hidden'].includes(next_)) {
      return res.status(400).json({
        message: 'status must be open, claimed or hidden. A listing becomes returned only '
               + 'when its approved claim handover is completed.'
      });
    }
    const existing = await items.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Listing not found' });

    const updated = await items.setStatus(existing.id, next_);
    await notify.audit({
      actor: req.user.id, actorEmail: req.user.email,
      action: `item.status.${next_}`, targetType: 'item', targetId: existing.id,
      note: `was ${existing.status}`
    });
    res.status(200).json({ message: `Status set to ${next_}`, item: updated });
  } catch (err) { next(err); }
});

/** DELETE /api/admin/items/:id */
admin.delete('/items/:id', protect, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const existing = await items.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Listing not found' });
    await items.remove(existing.id);
    await notify.audit({
      actor: req.user.id, actorEmail: req.user.email,
      action: 'item.delete', targetType: 'item', targetId: existing.id, note: existing.title
    });
    res.status(200).json({ message: 'Listing removed' });
  } catch (err) { next(err); }
});

/** PATCH /api/admin/users/:id/suspend — suspend and reinstate. */
admin.patch('/users/:id/suspend', protect, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const suspended = req.body.suspended !== false;
    const target = await users.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (['admin', 'superadmin'].includes(target.role)) {
      return res.status(403).json({ message: 'An administrator cannot be suspended here' });
    }
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (suspended && reason.length < 3) {
      return res.status(400).json({ message: 'A reason is required to suspend an account' });
    }
    const row = await one(
      `update users set suspended = $2, suspended_reason = $3, suspended_at = case when $2 then now() else null end
        where id = $1 returning *`, [target.id, suspended, suspended ? reason : '']);
    await notify.audit({
      actor: req.user.id, actorEmail: req.user.email,
      action: suspended ? 'user.suspend' : 'user.reinstate',
      targetType: 'user', targetId: target.id, note: reason
    });
    res.status(200).json({
      message: suspended ? 'Account suspended' : 'Account reinstated',
      user: users.toSafeObject(users.toUser(row))
    });
  } catch (err) { next(err); }
});

/** PATCH /api/admin/users/:id/role */
admin.patch('/users/:id/role', protect, requireRole('superadmin'), async (req, res, next) => {
  try {
    const role = typeof req.body.role === 'string' ? req.body.role.trim() : '';
    if (!['student', 'faculty', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'role must be student, faculty, moderator or admin' });
    }
    const target = await users.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (target.role === 'superadmin') {
      return res.status(403).json({ message: 'A superadmin role cannot be changed here' });
    }
    const row = await one('update users set role = $2 where id = $1 returning *', [target.id, role]);
    await notify.audit({
      actor: req.user.id, actorEmail: req.user.email,
      action: 'user.role', targetType: 'user', targetId: target.id,
      note: `${target.role} -> ${role}`
    });
    res.status(200).json({
      message: `Role set to ${role}`, user: users.toSafeObject(users.toUser(row))
    });
  } catch (err) { next(err); }
});

/** PATCH /api/admin/reports/:id — resolve or dismiss. */
admin.patch('/reports/:id', protect, requireRole(...STAFF), async (req, res, next) => {
  try {
    const requested = typeof req.body.status === 'string' ? req.body.status.trim() : '';
    // The page sends 'resolved'; the schema stores 'reviewed'.
    const status = requested === 'resolved' ? 'reviewed' : requested;
    if (!['reviewed', 'dismissed', 'actioned'].includes(status)) {
      return res.status(400).json({ message: 'status must be resolved, dismissed or actioned' });
    }
    const row = await one(
      `update reports set status = $2, reviewed_by = $3, reviewed_at = now()
        where id = $1 returning *`, [req.params.id, status, req.user.id]);
    if (!row) return res.status(404).json({ message: 'Report not found' });
    await notify.audit({
      actor: req.user.id, actorEmail: req.user.email,
      action: `report.${status}`, targetType: 'report', targetId: row.id
    });
    res.status(200).json({ message: `Report ${status}`, report: { id: row.id, status } });
  } catch (err) { next(err); }
});

/** GET /api/admin/users — the account list the admin page builds from. */
admin.get('/users', protect, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const rows = await many('select * from users order by created_at desc limit 200');
    res.status(200).json({
      count: rows.length,
      users: rows.map((r) => ({
        ...users.toSafeObject(users.toUser(r)),
        pendingApproval: r.pending_approval,
        approvalNote: r.approval_note,
        emailVerified: r.email_verified,
        suspended: r.suspended,
        suspendedReason: r.suspended_reason
      }))
    });
  } catch (err) { next(err); }
});

/** PATCH /api/admin/users/:id/approve — approve or reject an application. */
admin.patch('/users/:id/approve', protect, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const target = await users.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    if (req.body.approved === false) {
      const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
      if (note.length < 3) {
        return res.status(400).json({ message: 'A reason is required to reject an application' });
      }
      const rejected = await users.reject(target.id, note);
      notify.create(null, {
        userId: target.id, type: 'account_rejected',
        message: `Your account application was not approved. ${note}`,
        link: 'auth.html', relatedType: 'user', relatedId: target.id
      }).catch(() => {});
      await notify.audit({
        actor: req.user.id, actorEmail: req.user.email,
        action: 'user.rejected', targetType: 'user', targetId: target.id, note
      });
      return res.status(200).json({
        message: 'Application rejected', user: users.toSafeObject(rejected)
      });
    }

    const approved = await users.approve(target.id);
    notify.create(null, {
      userId: target.id, type: 'account_approved',
      message: 'Your account has been approved. You can sign in now.',
      link: 'auth.html', relatedType: 'user', relatedId: target.id
    }).catch(() => {});
    await notify.audit({
      actor: req.user.id, actorEmail: req.user.email,
      action: 'user.approved', targetType: 'user', targetId: target.id
    });
    res.status(200).json({ message: 'Account approved', user: users.toSafeObject(approved) });
  } catch (err) { next(err); }
});

module.exports = { notifications, dashboard, leaderboard, campus, reports, admin };
