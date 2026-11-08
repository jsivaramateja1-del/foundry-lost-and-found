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
    const r = await one(
      `update notifications set read = true
        where user_id = $1 and read = false returning id`, [req.user.id]);
    res.status(200).json({ updated: r ? 1 : 0, message: 'All notifications marked read' });
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
      `select c.id, c.status, c.message, c.created_at, i.title as item_title
         from claims c join items i on i.id = c.item
        where c.claimant = $1 order by c.created_at desc limit 50`, [req.user.id]);
    const claimsReceived = await many(
      `select c.id, c.status, c.message, c.created_at, u.name as claimant_name
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
      badges: [],
      items: mine.items,
      claims: claimsMade.map((c) => ({ ...c, itemTitle: c.item_title })),
      claimsReceived: claimsReceived.map((c) => ({ ...c, claimantName: c.claimant_name })),
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
    if (!['spam','inappropriate','fake','other'].includes(reason)) {
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

admin.get('/users', protect, requireRole('admin','superadmin'), async (req, res, next) => {
  try {
    const rows = await many(
      `select id, name, email, role, points, email_verified, pending_approval, suspended, created_at
         from users order by created_at desc limit 100`);
    res.status(200).json({ users: rows });
  } catch (err) { next(err); }
});

admin.patch('/users/:id/approve', protect, requireRole('admin','superadmin'), async (req, res, next) => {
  try {
    const target = await users.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });

    if (req.body.approved === false) {
      const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
      if (note.length < 3) return res.status(400).json({ message: 'A reason is required to reject an application' });
      return res.status(200).json({ user: users.toSafeObject(await users.reject(target.id, note)) });
    }
    res.status(200).json({ user: users.toSafeObject(await users.approve(target.id)) });
  } catch (err) { next(err); }
});

/** Verifying a found listing is what earns the finder points — and the email. */
admin.patch('/items/:id/verify', protect, requireRole('moderator','admin','superadmin'), async (req, res, next) => {
  try {
    const item = await items.findByIdRaw(req.params.id);
    if (!item) return res.status(404).json({ message: 'Listing not found' });
    if (item.type !== 'found') return res.status(400).json({ message: 'Only found listings can be verified' });
    if (item.verifiedAt) return res.status(409).json({ message: 'That listing is already verified' });

    const verified = await items.verify(item.id, req.user.id);
    await points.awardOnce({
      userId: item.reportedBy, type: 'found_item',
      eventKey: `found:${item.id}`, itemId: item.id
    });

    const reporter = await users.findById(item.reportedBy);
    if (reporter) {
      mailer.send('itemVerified', reporter.email, {
        name: reporter.name, title: item.title, link: `${appUrl()}/index.html`
      }).catch(() => {});
    }
    res.status(200).json({ item: verified });
  } catch (err) { next(err); }
});

module.exports = { notifications, dashboard, leaderboard, campus, reports, admin };
