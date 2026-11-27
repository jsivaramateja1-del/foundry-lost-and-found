const express = require('express');
const jwt = require('jsonwebtoken');
const users = require('../repositories/users');
const items = require('../repositories/items');
const { protect, requireRole } = require('../middleware/auth.v2');

const { itemIpLimit, itemAccountLimit } = require('../middleware/rateLimit');
const { optionalAuth } = require('../middleware/auth.v2');
const { many } = require('../config/pg');

const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;

const MAGIC = [
  { type: 'png',  sig: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) },
  { type: 'jpeg', sig: Buffer.from([0xFF, 0xD8, 0xFF]) },
  { type: 'webp', sig: Buffer.from('RIFF'), extra: { offset: 8, value: Buffer.from('WEBP') } }
];

function imageProblem(raw) {
  if (!raw) return null;
  if (raw.length > IMAGE_LIMIT_BYTES) return 'That photo is too large (max 5 MB).';

  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!m) return 'The photo must be a PNG, JPEG or WebP image.';

  const declared = m[1];
  let bytes;
  try { bytes = Buffer.from(m[2], 'base64'); } catch { return 'That photo could not be read.'; }
  if (!bytes.length) return 'That photo is empty.';

  const match = MAGIC.find((f) =>
    bytes.length >= f.sig.length &&
    bytes.subarray(0, f.sig.length).equals(f.sig) &&
    (!f.extra || (bytes.length >= f.extra.offset + f.extra.value.length &&
                  bytes.subarray(f.extra.offset, f.extra.offset + f.extra.value.length).equals(f.extra.value))));

  if (!match) return 'That file is not a valid image.';
  if (match.type !== declared) {
    return `That file says ${declared} but its contents are ${match.type}.`;
  }
  return null;
}

const router = express.Router();

const { CATEGORIES, LOCATIONS, isValidSubcategory } = require('../utils/categories');

const TYPES = ['lost','found'];
const STATUSES = ['open','claimed','returned','hidden'];

const oneValue = (v) => (typeof v === 'string' ? v.trim() : '');

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    for (const key of ['type','category','location','status','subcategory','q','sort',
                       'from','to','page','limit']) {
      if (req.query[key] !== undefined && typeof req.query[key] !== 'string') {
        return res.status(400).json({ message: `${key} must be a single value` });
      }
    }

    const filter = {};
    const type = oneValue(req.query.type);
    if (type && type !== 'all') {
      if (!TYPES.includes(type)) return res.status(400).json({ message: 'type must be lost or found' });
      filter.type = type;
    }
    const category = oneValue(req.query.category);
    if (category && category !== 'all') {
      if (!CATEGORIES.includes(category)) return res.status(400).json({ message: 'Unknown category' });
      filter.category = category;
    }
    const location = oneValue(req.query.location);
    if (location && location !== 'all') {
      if (!LOCATIONS.includes(location)) return res.status(400).json({ message: 'Unknown location' });
      filter.location = location;
    }
    const status = oneValue(req.query.status);
    if (status && status !== 'all') {
      if (!STATUSES.includes(status)) return res.status(400).json({ message: 'Unknown status' });
      filter.status = status;
    }
    const sub = oneValue(req.query.subcategory);
    if (sub && sub !== 'all') filter.subcategory = sub;
    const q = oneValue(req.query.q);
    if (q) filter.q = q.slice(0, 80);

    for (const k of ['from', 'to']) {
      const v = oneValue(req.query[k]);
      if (!v) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return res.status(400).json({ message: `${k} must be YYYY-MM-DD` });
      }
      filter[k] = v;
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const sort = oneValue(req.query.sort) || 'newest';

    const { total, items: rows } = await items.list(filter, { page, limit, sort });

    let publicRows = rows.map(items.toPublicItem);
    if (req.user) {
      const mine = await many('select id from items where reported_by = $1', [req.user.id]);
      const claimed = await many('select distinct item as id from claims where claimant = $1', [req.user.id]);
      const allowed = new Set([...mine.map((r) => r.id), ...claimed.map((r) => r.id)]);
      publicRows = publicRows.map((it) => ({ ...it, canMessage: allowed.has(it.id) }));
    }

    res.status(200).json({
      count: publicRows.length, total, page,
      pages: Math.ceil(total / limit) || 1,
      items: publicRows
    });
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try { res.status(200).json(await items.stats()); } catch (err) { next(err); }
});

router.get('/meta', (req, res) => {
  const { CATEGORY_TREE } = require('../utils/categories');
  res.status(200).json({
    categories: CATEGORIES, locations: LOCATIONS, types: TYPES, statuses: STATUSES,

    subcategories: CATEGORY_TREE
  });
});

async function optionalViewer(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await users.findById(decoded.id);
    if (!user) return null;
    if ((decoded.tv === undefined ? 0 : decoded.tv) !== (user.tokenVersion || 0)) return null;
    return user;
  } catch {
    return null;
  }
}

router.get('/:id', async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await items.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Listing not found' });

    const viewer = await optionalViewer(req);
    const out = items.toPublicItem(item);
    if (viewer && viewer.id === item.reportedBy) out.reportedBy = item.reportedBy;
    res.status(200).json({ item: out });
  } catch (err) { next(err); }
});

router.get('/:id/similar', async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await items.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Listing not found' });
    const rows = await items.similar(item);
    res.status(200).json({ count: rows.length, items: rows });
  } catch (err) { next(err); }
});

function announceToSubscribers(item) {
  (async () => {
    try {
      const whatsapp = require('../lib/whatsapp');
      if (!whatsapp.isConfigured()) return;
      const subscriptions = require('../repositories/whatsapp');
      const people = await subscriptions.listSubscribers();
      if (!people.length) return;
      await whatsapp.notifyNewListing(people, item);
    } catch (err) {
      console.log('[whatsapp] announcement skipped:', err && err.message);
    }
  })();
}

router.post('/', itemIpLimit, protect, itemAccountLimit, async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = oneValue(b.title);
    const category = oneValue(b.category);
    const location = oneValue(b.location);
    const type = oneValue(b.type);
    const date = oneValue(b.date);

    const imgProblem = imageProblem(oneValue(b.imageUrl));
    if (imgProblem) return res.status(400).json({ message: imgProblem });

    if (title.length < 2) return res.status(400).json({ message: 'A title is required' });
    if (title.length > 120) return res.status(400).json({ message: 'Title is too long (max 120 characters)' });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ message: 'Unknown category' });

    if (location === 'Other') {
      if (!oneValue(b.customLocation).trim()) {
        return res.status(400).json({ message: 'Type where it was, since you chose Other' });
      }
    } else if (!LOCATIONS.includes(location)) {
      return res.status(400).json({ message: 'Unknown location' });
    }
    if (!TYPES.includes(type)) return res.status(400).json({ message: 'type must be lost or found' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'date must be YYYY-MM-DD' });

    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ message: 'That date does not exist' });
    }

    if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      return res.status(400).json({ message: 'The date cannot be in the future' });
    }

    if (oneValue(b.description).length > 2000) {
      return res.status(400).json({ message: 'Description is too long (max 2000 characters)' });
    }
    if (oneValue(b.subcategory).length > 60) {
      return res.status(400).json({ message: 'Subcategory is too long (max 60 characters)' });
    }

    if (oneValue(b.customCategory).trim().length > 60) {
      return res.status(400).json({ message: 'Custom category is too long (max 60 characters)' });
    }
    if (oneValue(b.customLocation).trim().length > 60) {
      return res.status(400).json({ message: 'Custom location is too long (max 60 characters)' });
    }

    if (!isValidSubcategory(category, oneValue(b.subcategory))) {
      return res.status(400).json({ message: 'That subcategory does not belong to that category' });
    }

    if (category === 'Other' && !oneValue(b.customCategory).trim()) {
      return res.status(400).json({ message: 'Please describe the category when you choose Other' });
    }

    const created = await items.create({
      title, description: oneValue(b.description), category,
      subcategory: oneValue(b.subcategory), customCategory: oneValue(b.customCategory),
      location, customLocation: oneValue(b.customLocation), date, type,
      imageUrl: oneValue(b.imageUrl), reportedBy: req.user.id
    });

    announceToSubscribers(created);

    res.status(201).json({ item: created });
  } catch (err) { next(err); }
});

router.use('/:id/messages', require('./messages.v2.routes'));

router.put('/:id', protect, async (req, res, next) => {
  try {
    const existing = await items.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Listing not found' });
    if (existing.reportedBy !== req.user.id) {
      return res.status(403).json({ message: 'You can only edit your own listing' });
    }
    const b = req.body || {};

    const nextTitle = oneValue(b.title) || existing.title;
    const nextDesc = b.description !== undefined ? oneValue(b.description) : existing.description;
    const nextCategory = CATEGORIES.includes(oneValue(b.category)) ? oneValue(b.category) : existing.category;
    const nextSub = b.subcategory !== undefined ? oneValue(b.subcategory) : existing.subcategory;
    const nextLocation = LOCATIONS.includes(oneValue(b.location)) ? oneValue(b.location) : existing.location;

    const existingDate = existing.date instanceof Date
      ? existing.date.toISOString().slice(0, 10)
      : String(existing.date || '').slice(0, 10);
    const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(oneValue(b.date)) ? oneValue(b.date) : existingDate;
    const nextImage = b.imageUrl !== undefined ? oneValue(b.imageUrl) : existing.imageUrl;
    if (b.imageUrl !== undefined) {
      const imgProblem = imageProblem(oneValue(b.imageUrl));
      if (imgProblem) return res.status(400).json({ message: imgProblem });
    }

    if (nextTitle.length < 2) return res.status(400).json({ message: 'A title is required' });
    if (nextTitle.length > 120) return res.status(400).json({ message: 'Title is too long (max 120 characters)' });
    if (nextDesc.length > 2000) return res.status(400).json({ message: 'Description is too long (max 2000 characters)' });
    if (nextSub.length > 60) return res.status(400).json({ message: 'Subcategory is too long (max 60 characters)' });
    if (String(nextCustomCategory || '').trim().length > 60) {
      return res.status(400).json({ message: 'Custom category is too long (max 60 characters)' });
    }
    if (String(b.customLocation !== undefined ? oneValue(b.customLocation) : existing.customLocation || '').trim().length > 60) {
      return res.status(400).json({ message: 'Custom location is too long (max 60 characters)' });
    }

    if (b.category !== undefined && !CATEGORIES.includes(oneValue(b.category))) {
      return res.status(400).json({ message: 'Unknown category' });
    }
    if (b.location !== undefined && !LOCATIONS.includes(oneValue(b.location))) {
      return res.status(400).json({ message: 'Unknown location' });
    }
    if (b.type !== undefined && !TYPES.includes(oneValue(b.type))) {
      return res.status(400).json({ message: 'type must be lost or found' });
    }
    const nextCustomCategory = b.customCategory !== undefined
      ? oneValue(b.customCategory) : existing.customCategory;
    if (nextCategory === 'Other' && !String(nextCustomCategory || '').trim()) {
      return res.status(400).json({ message: 'Please describe the category when you choose Other' });
    }
    if (!isValidSubcategory(nextCategory, nextSub)) {
      return res.status(400).json({ message: 'That subcategory does not belong to that category' });
    }
    const nextParsed = new Date(`${nextDate}T00:00:00Z`);
    if (Number.isNaN(nextParsed.getTime()) || nextParsed.toISOString().slice(0, 10) !== nextDate) {
      return res.status(400).json({ message: 'That date does not exist' });
    }
    if (nextParsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      return res.status(400).json({ message: 'The date cannot be in the future' });
    }
    if (nextImage) {
      if (nextImage.length > 400 * 1024) {
        return res.status(400).json({ message: 'That photo is too large (max 400 KB).' });
      }
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(nextImage)) {
        return res.status(400).json({ message: 'The photo must be a PNG, JPEG or WebP image.' });
      }
    }

    const updated = await items.update(existing.id, {
      title: nextTitle,
      description: nextDesc,
      category: nextCategory,
      subcategory: nextSub,
      customCategory: b.customCategory !== undefined ? oneValue(b.customCategory) : existing.customCategory,
      location: nextLocation,
      customLocation: b.customLocation !== undefined ? oneValue(b.customLocation) : existing.customLocation,
      date: nextDate,
      imageUrl: nextImage,
      type: TYPES.includes(oneValue(b.type)) ? oneValue(b.type) : existing.type
    });
    res.status(200).json({ item: updated });
  } catch (err) { next(err); }
});

router.delete('/:id', protect, async (req, res, next) => {
  try {
    const existing = await items.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Listing not found' });
    const isOwner = existing.reportedBy === req.user.id;
    const isAdmin = ['admin','superadmin'].includes(req.user.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'You can only delete your own listing' });
    }
    await items.remove(existing.id);
    res.status(200).json({ message: 'Listing deleted' });
  } catch (err) { next(err); }
});

router.patch('/:id/status', protect, async (req, res, next) => {
  try {
    const requested = oneValue(req.body.status);

    const next_ = requested === 'closed' ? 'hidden' : requested;

    const STAFF = ['moderator', 'admin', 'superadmin'];

    const OWNER_STATUSES = ['open'];
    const STAFF_STATUSES = ['open', 'hidden'];

    const existing = await items.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Listing not found' });

    const isOwner = existing.reportedBy === req.user.id;
    const isStaff = STAFF.includes(req.user.role);

    if (!isStaff && existing.status === 'claimed' && next_ === 'open') {
      return res.status(409).json({
        message: 'This listing has an approved claim. Complete the handover, or ask a moderator.'
      });
    }

    if (!isOwner && !isStaff) {
      return res.status(403).json({ message: 'You can only change your own listing' });
    }

    if (next_ === 'hidden' && !isStaff) {
      return res.status(403).json({ message: 'Only a moderator can hide a listing' });
    }

    if (!isStaff && existing.status === 'hidden') {
      return res.status(403).json({
        message: 'This listing was hidden by a moderator and cannot be reopened by its owner'
      });
    }

    if (existing.status === 'returned' && next_ === 'open') {
      return res.status(403).json({
        message: 'This listing was returned and cannot be reopened. Hide it instead if it should be removed.'
      });
    }

    const allowed = next_ === 'hidden' ? STAFF_STATUSES : OWNER_STATUSES;
    if (!allowed.includes(next_)) {
      return res.status(400).json({ message: 'Unsupported status' });
    }

    if (req.user.role === 'moderator' && next_ === 'open') {
      if (isOwner) {
        return res.status(403).json({ message: 'A moderator cannot restore their own listing' });
      }
      if (existing.status !== 'hidden') {
        return res.status(403).json({ message: 'Moderators can only restore hidden listings' });
      }
    }
    res.status(200).json({ item: await items.setStatus(existing.id, next_) });
  } catch (err) { next(err); }
});

module.exports = router;
