const express = require('express');
const items = require('../repositories/items');
const { protect, requireRole } = require('../middleware/auth.v2');

const router = express.Router();

const CATEGORIES = ['Electronics','IDs & Cards','Bags','Books & Notes','Bottles',
  'Keys & Accessories','Clothing','Other'];
const LOCATIONS = ['Library','Main Block','Canteen','Hostel A','Hostel B',
  'Sports Complex','Auditorium','Parking','Other'];
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

router.post('/', protect, async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = oneValue(b.title);
    const category = oneValue(b.category);
    const location = oneValue(b.location);
    const type = oneValue(b.type);
    const date = oneValue(b.date);

    if (title.length < 2) return res.status(400).json({ message: 'A title is required' });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ message: 'Unknown category' });
    if (!LOCATIONS.includes(location)) return res.status(400).json({ message: 'Unknown location' });
    if (!TYPES.includes(type)) return res.status(400).json({ message: 'type must be lost or found' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'date must be YYYY-MM-DD' });

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
      imageUrl: b.imageUrl !== undefined ? oneValue(b.imageUrl) : existing.imageUrl
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
router.patch('/:id/status', protect, requireRole('moderator','admin','superadmin'), async (req, res, next) => {
  try {
    const next_ = oneValue(req.body.status);
    if (!['open','hidden'].includes(next_)) {
      return res.status(400).json({ message: 'status must be open or hidden' });
    }
    const existing = await items.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Listing not found' });

    if (req.user.role === 'moderator' && next_ === 'open') {
      if (existing.reportedBy === req.user.id) {
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
