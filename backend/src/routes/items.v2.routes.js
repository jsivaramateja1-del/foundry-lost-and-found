const express = require('express');
const items = require('../repositories/items');
const { protect, requireRole } = require('../middleware/auth.v2');
// These were defined and exported but never mounted, so listing creation was
// unthrottled while the README documented a limit that did not exist.
const { itemIpLimit, itemAccountLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Imported, not duplicated. This file used to carry its own copy of the
// category and location lists, so editing utils/categories.js changed nothing
// here — and this copy is what validates every submission.
const { CATEGORIES, LOCATIONS } = require('../utils/categories');

const TYPES = ['lost','found'];
const STATUSES = ['open','claimed','returned','hidden'];

/** Rejects an array or object arriving where a single value is expected. */
const oneValue = (v) => (typeof v === 'string' ? v.trim() : '');

router.get('/', async (req, res, next) => {
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

    // The date-range filter the board sends. It was silently ignored, so the
    // UI showed unfiltered results while claiming a range was applied.
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
    res.status(200).json({
      count: rows.length, total, page,
      pages: Math.ceil(total / limit) || 1, items: rows
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
    // The form populates its subcategory selects from this map; without it the
    // dropdowns only ever contained the placeholder.
    subcategories: CATEGORY_TREE
  });
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await items.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Listing not found' });
    res.status(200).json({ item });
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

router.post('/', itemIpLimit, protect, itemAccountLimit, async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = oneValue(b.title);
    const category = oneValue(b.category);
    const location = oneValue(b.location);
    const type = oneValue(b.type);
    const date = oneValue(b.date);

    // The client shrinks photos to fit, but a client-side limit is not a limit.
    // Without this, a curl call stores megabytes in a text column, and any URL
    // shape at all — including javascript: — is accepted into image_url.
    const IMAGE_LIMIT_BYTES = 400 * 1024;
    const rawImage = oneValue(b.imageUrl);
    if (rawImage) {
      if (rawImage.length > IMAGE_LIMIT_BYTES) {
        return res.status(400).json({ message: 'That photo is too large (max 400 KB).' });
      }
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(rawImage)) {
        return res.status(400).json({ message: 'The photo must be a PNG, JPEG or WebP image.' });
      }
    }


    if (title.length < 2) return res.status(400).json({ message: 'A title is required' });
    if (title.length > 120) return res.status(400).json({ message: 'Title is too long (max 120 characters)' });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ message: 'Unknown category' });
    if (!LOCATIONS.includes(location)) return res.status(400).json({ message: 'Unknown location' });
    if (!TYPES.includes(type)) return res.status(400).json({ message: 'type must be lost or found' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'date must be YYYY-MM-DD' });

    // A real calendar date, not just the right shape: 2026-02-30 must be refused
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ message: 'That date does not exist' });
    }
    // One day of slack so a late-evening report from another timezone still passes
    if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      return res.status(400).json({ message: 'The date cannot be in the future' });
    }

    if (oneValue(b.description).length > 2000) {
      return res.status(400).json({ message: 'Description is too long (max 2000 characters)' });
    }
    if (oneValue(b.subcategory).length > 60) {
      return res.status(400).json({ message: 'Subcategory is too long (max 60 characters)' });
    }
    // "Other" with no explanation stores a listing nobody can search for
    if (category === 'Other' && !oneValue(b.customCategory).trim()) {
      return res.status(400).json({ message: 'Please describe the category when you choose Other' });
    }
    if (location === 'Other' && !oneValue(b.customLocation).trim()) {
      return res.status(400).json({ message: 'Please describe the location when you choose Other' });
    }

    const created = await items.create({
      title, description: oneValue(b.description), category,
      subcategory: oneValue(b.subcategory), customCategory: oneValue(b.customCategory),
      location, customLocation: oneValue(b.customLocation), date, type,
      imageUrl: oneValue(b.imageUrl), reportedBy: req.user.id
    });
    res.status(201).json({ item: created });
  } catch (err) { next(err); }
});

router.put('/:id', protect, async (req, res, next) => {
  try {
    const existing = await items.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Listing not found' });
    if (existing.reportedBy !== req.user.id) {
      return res.status(403).json({ message: 'You can only edit your own listing' });
    }
    const b = req.body || {};
    const updated = await items.update(existing.id, {
      title: oneValue(b.title) || existing.title,
      description: b.description !== undefined ? oneValue(b.description) : existing.description,
      category: CATEGORIES.includes(oneValue(b.category)) ? oneValue(b.category) : existing.category,
      subcategory: b.subcategory !== undefined ? oneValue(b.subcategory) : existing.subcategory,
      customCategory: b.customCategory !== undefined ? oneValue(b.customCategory) : existing.customCategory,
      location: LOCATIONS.includes(oneValue(b.location)) ? oneValue(b.location) : existing.location,
      customLocation: b.customLocation !== undefined ? oneValue(b.customLocation) : existing.customLocation,
      date: /^\d{4}-\d{2}-\d{2}$/.test(oneValue(b.date)) ? oneValue(b.date) : existing.date,
      imageUrl: b.imageUrl !== undefined ? oneValue(b.imageUrl) : existing.imageUrl,
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

/** Moderation: hide or restore. Moderators may restore others' listings to open. */
router.patch('/:id/status', protect, async (req, res, next) => {
  try {
    const requested = oneValue(req.body.status);
    // The dashboard still offers 'closed'; the schema has no such state, and a
    // closed listing is a hidden one.
    const next_ = requested === 'closed' ? 'hidden' : requested;

    const STAFF = ['moderator', 'admin', 'superadmin'];
    const OWNER_STATUSES = ['open', 'claimed', 'returned'];
    const STAFF_STATUSES = ['open', 'hidden'];

    const existing = await items.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Listing not found' });

    const isOwner = existing.reportedBy === req.user.id;
    const isStaff = STAFF.includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ message: 'You can only change your own listing' });
    }

    // An owner moves their listing through its lifecycle; only staff may hide.
    if (next_ === 'hidden' && !isStaff) {
      return res.status(403).json({ message: 'Only a moderator can hide a listing' });
    }
    // An owner must not be able to undo a moderation decision: a listing that
    // staff hid stays hidden until staff restore it.
    if (!isStaff && existing.status === 'hidden') {
      return res.status(403).json({
        message: 'This listing was hidden by a moderator and cannot be reopened by its owner'
      });
    }
    // A returned listing is settled: reopening it would erase the completed
    // handover and the points already credited to both parties.
    if (!isStaff && existing.status === 'returned' && next_ !== 'returned') {
      return res.status(403).json({
        message: 'This listing is marked returned and can only be reopened by a moderator'
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
