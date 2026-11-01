const express = require('express');
const mongoose = require('mongoose');
const Item = require('../models/Item');
const { CATEGORIES, LOCATIONS } = require('../models/Item');
const { protect } = require('../middleware/auth');

const router = express.Router();

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Shape an item for the API, exposing only the reporter's display name */
const publicItem = (doc) => {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: obj._id,
    title: obj.title,
    description: obj.description,
    category: obj.category,
    customCategory: obj.customCategory || '',
    location: obj.location,
    customLocation: obj.customLocation || '',
    date: obj.date,
    type: obj.type,
    status: obj.status,
    imageUrl: obj.imageUrl || '',
    reportedBy: obj.reportedBy && obj.reportedBy.name
      ? { id: obj.reportedBy._id, name: obj.reportedBy.name }
      : obj.reportedBy,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
};

/** Shared validation for create and update */
const validateItemBody = (body, { partial = false } = {}) => {
  const errors = [];
  const required = ['title', 'description', 'category', 'location', 'date', 'type'];
  if (!partial) {
    required.forEach((field) => {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        errors.push(`${field} is required`);
      }
    });
  }
  if (body.category !== undefined && !CATEGORIES.includes(body.category)) {
    errors.push(`category must be one of: ${CATEGORIES.join(', ')}`);
  }
  if (body.location !== undefined && !LOCATIONS.includes(body.location)) {
    errors.push(`location must be one of: ${LOCATIONS.join(', ')}`);
  }
  if (body.type !== undefined && !['lost', 'found'].includes(body.type)) {
    errors.push('type must be either lost or found');
  }
  // Choosing "Other" without saying what it is would create a useless listing
  if (body.category === 'Other' && !String(body.customCategory || '').trim()) {
    errors.push('Please describe the category when you select Other');
  }
  if (body.location === 'Other' && !String(body.customLocation || '').trim()) {
    errors.push('Please describe the location when you select Other');
  }
  if (body.date !== undefined && Number.isNaN(new Date(body.date).getTime())) {
    errors.push('date must be a valid date');
  }
  return errors;
};

/**
 * GET /api/items
 * Public. Supports keyword search, filters, sorting and pagination.
 * Query: q, category, location, type, status, sort, page, limit
 */
router.get('/', async (req, res, next) => {
  try {
    const { q, category, location, type, status, sort = 'newest' } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const filter = {};
    if (q && String(q).trim()) {
      const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
      filter.$or = [{ title: rx }, { description: rx }, { customCategory: rx }];
    }
    if (category && category !== 'all') filter.category = category;
    if (location && location !== 'all') filter.location = location;
    if (type && type !== 'all') filter.type = type;
    if (status && status !== 'all') filter.status = status;

    const sortMap = {
      newest: { date: -1, createdAt: -1 },
      oldest: { date: 1, createdAt: 1 },
      title: { title: 1 },
      'title-desc': { title: -1 }
    };
    const sortBy = sortMap[sort] || sortMap.newest;

    const total = await Item.countDocuments(filter);
    const items = await Item.find(filter)
      .populate('reportedBy', 'name')
      .sort(sortBy)
      .skip((page - 1) * limit)
      .limit(limit);

    res.status(200).json({
      count: items.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      items: items.map(publicItem)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/items/meta
 * Public. Dropdown values for the frontend forms and filters.
 */
router.get('/meta', (req, res) => {
  res.status(200).json({
    categories: CATEGORIES,
    locations: LOCATIONS,
    types: ['lost', 'found'],
    statuses: ['open', 'claimed', 'returned', 'closed']
  });
});

/**
 * GET /api/items/:id
 * Public. Single listing detail.
 */
router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findById(req.params.id).populate('reportedBy', 'name');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.status(200).json({ item: publicItem(item) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/items/:id/similar
 * Public. Custom feature: duplicate-item alert.
 * Finds listings of the same type in the same category whose title shares
 * meaningful words with this one, so users can spot an existing match.
 */
router.get('/:id/similar', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    const stop = new Set(['the', 'a', 'an', 'my', 'and', 'with', 'of', 'in', 'on', 'for', 'black', 'blue', 'new']);
    const words = String(item.title)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !stop.has(w));

    const or = [];
    words.forEach((w) => {
      const rx = new RegExp(escapeRegex(w), 'i');
      or.push({ title: rx }, { description: rx });
    });

    const candidates = or.length
      ? await Item.find({
          _id: { $ne: item._id },
          category: item.category,
          type: item.type === 'lost' ? 'found' : 'lost',
          $or: or
        })
          .populate('reportedBy', 'name')
          .limit(5)
      : [];

    res.status(200).json({ count: candidates.length, items: candidates.map(publicItem) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/items
 * Protected. Creates a lost or found report.
 */
router.post('/', protect, async (req, res, next) => {
  try {
    const errors = validateItemBody(req.body);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    const item = await Item.create({
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      customCategory: req.body.customCategory,
      location: req.body.location,
      customLocation: req.body.customLocation,
      date: req.body.date,
      type: req.body.type,
      imageUrl: req.body.imageUrl || '',
      reportedBy: req.user._id
    });

    const populated = await item.populate('reportedBy', 'name');
    res.status(201).json({ message: 'Listing created', item: publicItem(populated) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/items/:id
 * Protected. Only the reporter or an admin may edit a listing.
 */
router.put('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    const isOwner = item.reportedBy.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only edit your own listings' });
    }

    const errors = validateItemBody(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    ['title', 'description', 'category', 'customCategory', 'location', 'customLocation', 'date', 'type', 'imageUrl', 'status']
      .forEach((field) => {
        if (req.body[field] !== undefined) item[field] = req.body[field];
      });

    await item.save();
    const populated = await item.populate('reportedBy', 'name');
    res.status(200).json({ message: 'Listing updated', item: publicItem(populated) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/items/:id/status
 * Protected. Reporter or admin marks an item claimed / returned / closed.
 * Marking an item returned awards gamification points.
 */
router.patch('/:id/status', protect, async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['open', 'claimed', 'returned', 'closed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${allowed.join(', ')}` });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }

    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    const isOwner = item.reportedBy.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only change the status of your own listings' });
    }

    // Remember the old status so points cannot be farmed by clicking twice
    const previousStatus = item.status;
    item.status = status;
    await item.save();

    // Award points once, the first time an item is marked returned
    if (status === 'returned' && previousStatus !== 'returned') {
      const User = require('../models/User');
      const Claim = require('../models/Claim');
      await User.findByIdAndUpdate(item.reportedBy, { $inc: { points: 10, returns: 1 } });
      const approved = await Claim.findOne({ item: item._id, status: 'approved' });
      if (approved) {
        await User.findByIdAndUpdate(approved.claimant, { $inc: { points: 10, returns: 1 } });
      }
    }

    const populated = await item.populate('reportedBy', 'name');
    res.status(200).json({ message: `Item marked ${status}`, item: publicItem(populated) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/items/:id
 * Protected. Reporter or admin.
 */
router.delete('/:id', protect, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    const isOwner = item.reportedBy.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only delete your own listings' });
    }

    const Claim = require('../models/Claim');
    await Claim.deleteMany({ item: item._id });
    await item.deleteOne();

    res.status(200).json({ message: 'Listing deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
