const express = require('express');
const mongoose = require('mongoose');
const Item = require('../models/Item');
const { CATEGORIES, LOCATIONS } = require('../models/Item');
const { CATEGORY_TREE, isValidSubcategory } = require('../utils/categories');
const { protect, requireVerified, identifyUser, ADMIN_ROLES, MODERATION_ROLES } = require('../middleware/auth');
const { notify } = require('../utils/notify');

const { itemIpLimit, itemAccountLimit, reportIpLimit, reportAccountLimit } = require('../middleware/rateLimit');
const Report = require('../models/Report');

const router = express.Router();

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Largest image we store: 400 KB once decoded. The frontend shrinks a photo
// before sending it, so this is a backstop, not the normal path.
const IMAGE_LIMIT_BYTES = 400 * 1024;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Accept either an https link or a small base64 image; refuse anything else.
 * Returns an error message, or null when the value is fine.
 */
const validateImage = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value);
  if (/^https:\/\/[^\s]+$/.test(str)) return null;
  if (!IMAGE_DATA_URL.test(str)) {
    return 'image must be an https link or a PNG, JPEG or WebP data URL';
  }
  const base64 = str.split(',')[1] || '';
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > IMAGE_LIMIT_BYTES) {
    return `image must be smaller than ${Math.round(IMAGE_LIMIT_BYTES / 1024)} KB`;
  }
  return null;
};

/**
 * A listing a moderator has taken down is visible only to its owner and to
 * staff. Everyone else gets the same answer as for a listing that does not
 * exist, which is what a takedown is supposed to look like.
 */
const canSeeHidden = (item, user) => {
  if (!user) return false;
  if (MODERATION_ROLES.includes(user.role)) return true;
  const reporter = item.reportedBy && item.reportedBy._id ? item.reportedBy._id : item.reportedBy;
  return Boolean(reporter) && String(reporter) === String(user._id);
};

/** Shape an item for the API, exposing only the reporter's display name */
const publicItem = (doc) => {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: obj._id,
    title: obj.title,
    description: obj.description,
    category: obj.category,
    subcategory: obj.subcategory || '',
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
  // A subcategory has to belong to the category it was chosen under
  if (body.category !== undefined && !isValidSubcategory(body.category, body.subcategory)) {
    errors.push(`subcategory must be one of: ${(CATEGORY_TREE[body.category] || []).join(', ')}`);
  }
  if (body.date !== undefined && Number.isNaN(new Date(body.date).getTime())) {
    errors.push('date must be a valid date');
  }
  const imageError = validateImage(body.imageUrl);
  if (imageError) errors.push(imageError);
  return errors;
};

/**
 * GET /api/items
 * Public. Supports keyword search, filters, sorting and pagination.
 * Query: q, category, location, type, status, sort, page, limit
 */
router.get('/', async (req, res, next) => {
  try {
    const { q, category, location, type, status, sort = 'newest', from, to } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    // Optional date range on the date the item was lost or found
    if (from && Number.isNaN(new Date(from).getTime())) {
      return res.status(400).json({ message: 'from must be a valid date' });
    }
    if (to && Number.isNaN(new Date(to).getTime())) {
      return res.status(400).json({ message: 'to must be a valid date' });
    }

    const filter = {};
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) {
        // A date-only value such as 2026-10-31 should include that whole day
        const end = new Date(to);
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }
    if (q && String(q).trim()) {
      const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
      // Keyword search covers the location too, so typing "Library" finds
      // items left in the library without reaching for the dropdown
      filter.$or = [
        { title: rx },
        { description: rx },
        { category: rx },
        { subcategory: rx },
        { customCategory: rx },
        { location: rx },
        { customLocation: rx }
      ];
    }
    // Express 4 parses ?category[$ne]=x into an object. Assigning that straight
    // into the query would hand MongoDB an operator the UI never offers, so every
    // filter is coerced to a plain string and checked against its vocabulary.
    // A repeated or bracketed parameter arrives as an array or object. Reject it
    // outright rather than quietly ignoring it, so a caller cannot tell whether
    // the filter was applied.
    const badParam = ['category', 'subcategory', 'location', 'type', 'status']
      .find((key) => req.query[key] !== undefined && typeof req.query[key] !== 'string');
    if (badParam) {
      return res.status(400).json({ message: `${badParam} must be a single value` });
    }

    const onlyString = (value) => (typeof value === 'string' ? value.trim() : '');
    const inList = (value, list) => (list.includes(value) ? value : null);

    const categoryFilter = onlyString(category);
    if (categoryFilter && categoryFilter !== 'all') {
      const safeCategory = inList(categoryFilter, CATEGORIES);
      if (!safeCategory) {
        return res.status(400).json({ message: 'category must be one of the listed categories' });
      }
      filter.category = safeCategory;
    }

    const subcategoryFilter = onlyString(req.query.subcategory);
    if (subcategoryFilter && subcategoryFilter !== 'all') {
      // Subcategories are per-category, so only the shape is checked here
      if (!/^[A-Za-z0-9 &/'-]{1,60}$/.test(subcategoryFilter)) {
        return res.status(400).json({ message: 'subcategory is not valid' });
      }
      filter.subcategory = subcategoryFilter;
    }

    const locationFilter = onlyString(location);
    if (locationFilter && locationFilter !== 'all') {
      const safeLocation = inList(locationFilter, LOCATIONS);
      if (!safeLocation) {
        return res.status(400).json({ message: 'location must be one of the listed locations' });
      }
      filter.location = safeLocation;
    }

    const typeFilter = onlyString(type);
    if (typeFilter && typeFilter !== 'all') {
      const safeType = inList(typeFilter, ['lost', 'found']);
      if (!safeType) {
        return res.status(400).json({ message: 'type must be either lost or found' });
      }
      filter.type = safeType;
    }
    if (status && status !== 'all') {
      const allowedStatuses = ['open', 'claimed', 'returned', 'closed'];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: 'status must be one of: open, claimed, returned, closed'
        });
      }

      filter.status = status;
    } else {
      // Nothing taken down by a moderator may appear on the public board
      filter.status = { $ne: 'hidden' };
    }

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
    subcategories: CATEGORY_TREE,
    locations: LOCATIONS,
    types: ['lost', 'found'],
    statuses: ['open', 'claimed', 'returned', 'closed']
  });
});

/**
 * GET /api/items/stats
 * Public. Genuine counts for the homepage tiles. The database counts them,
 * so the numbers stay right however many listings exist.
 */
router.get('/stats', async (req, res, next) => {
  try {
    // A listing a moderator has taken down is not part of the public board, so
    // it must not inflate the public counters either
    // Every public counter applies the same visibility rule. returned/claimed/
    // open cannot currently match a hidden listing because status holds one
    // value, but applying the rule uniformly means the invariant survives any
    // future change to how takedowns are represented.
    const visible = { status: { $ne: 'hidden' } };
    const [total, lost, found, returned, claimed, open] = await Promise.all([
      Item.countDocuments(visible),
      Item.countDocuments({ ...visible, type: 'lost' }),
      Item.countDocuments({ ...visible, type: 'found' }),
      Item.countDocuments({ ...visible, status: 'returned' }),
      Item.countDocuments({ ...visible, status: 'claimed' }),
      Item.countDocuments({ ...visible, status: 'open' })
    ]);
    // "Active" means still in play: open or claimed, not yet returned or closed
    res.status(200).json({ total, lost, found, returned, claimed, active: open + claimed });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/items/:id
 * Public. Single listing detail.
 */
router.get('/:id', identifyUser, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findById(req.params.id).populate('reportedBy', 'name');
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.status === 'hidden' && !canSeeHidden(item, req.user)) {
      return res.status(404).json({ message: 'Item not found' });
    }
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
router.get('/:id/similar', identifyUser, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.status === 'hidden' && !canSeeHidden(item, req.user)) {
      return res.status(404).json({ message: 'Item not found' });
    }

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
          status: { $ne: 'hidden' },
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
 * POST /api/items/:id/report
 * Protected. Flag a listing as spam, inappropriate, suspicious, incorrect or
 * "other". One report per student per listing. Only an admin reads these.
 */
router.post('/:id/report', reportIpLimit, protect, reportAccountLimit, async (req, res, next) => {
  try {
    const { reason, details } = req.body;

    if (!Report.REPORT_REASONS.includes(reason)) {
      return res.status(400).json({
        message: `reason must be one of: ${Report.REPORT_REASONS.join(', ')}`
      });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }

    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    if (item.reportedBy.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot report your own listing' });
    }

    const existing = await Report.findOne({ item: item._id, reportedBy: req.user._id });
    if (existing) {
      return res.status(409).json({ message: 'You have already reported this listing' });
    }

    const report = await Report.create({
      item: item._id,
      reportedBy: req.user._id,
      reason,
      details: String(details || '').trim()
    });

    res.status(201).json({
      message: 'Thank you. An administrator will review this listing.',
      report: { id: report._id, reason: report.reason, status: report.status, createdAt: report.createdAt }
    });
  } catch (err) {
    // The unique index is the real guard against a double submit
    if (err.code === 11000) {
      return res.status(409).json({ message: 'You have already reported this listing' });
    }
    next(err);
  }
});

/**
 * POST /api/items
 * Protected. Creates a lost or found report.
 */
router.post('/', itemIpLimit, protect, itemAccountLimit, requireVerified, async (req, res, next) => {
  try {
    const errors = validateItemBody(req.body);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    const item = await Item.create({
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      subcategory: req.body.subcategory,
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
    if (!isOwner && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: 'You can only edit your own listings' });
    }

    // Status has its own endpoint, which enforces the terminal-state rule and
    // awards points and notifications exactly once. An edit must not be a
    // second, unchecked way to move it.
    if (req.body.status !== undefined) {
      return res.status(400).json({
        message: 'status cannot be changed here. Use PATCH /api/items/:id/status'
      });
    }

    const errors = validateItemBody(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    ['title', 'description', 'category', 'subcategory', 'customCategory', 'location', 'customLocation', 'date', 'type', 'imageUrl']
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
 * Protected. Reporter or admin may change listing status, except returned.
 * A return must be confirmed through an approved claim handover.
 */
router.patch('/:id/status', protect, async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['open', 'claimed', 'returned', 'closed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${allowed.join(', ')}` });
    }
    if (status === 'returned') {
      return res.status(400).json({ message: 'A listing can only be marked returned after its approved claim handover is confirmed' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }

    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    const isOwner = item.reportedBy.toString() === req.user._id.toString();

    // Remember the old status so points cannot be farmed by clicking twice
    const previousStatus = item.status;

    // Who may move this listing:
    //   - the owner, on their own listing;
    //   - an administrator or superadmin, on any listing;
    //   - a moderator, but ONLY to undo a takedown (hidden -> open). A moderator
    //     has no general power over other people's visible listings: claiming,
    //     returning or closing someone else's item stays an administrator's call.
    const isAdministrator = ADMIN_ROLES.includes(req.user.role);
    const isModeratorRestore = req.user.role === 'moderator'
      && previousStatus === 'hidden'
      && status === 'open';

    if (!isOwner && !isAdministrator && !isModeratorRestore) {
      return res.status(403).json({
        message: req.user.role === 'moderator'
          ? 'Moderators can only restore a hidden listing to open'
          : 'You can only change the status of your own listings'
      });
    }

    if (previousStatus === status) {
      return res.status(400).json({ message: `This listing is already ${status}` });
    }
    // A takedown is reversed by someone else: another moderator, an
    // administrator or a superadmin. The owner cannot reverse it, and that
    // includes an owner who is a moderator themselves — a moderator reaching
    // this point only because they own the listing is still refused.
    if (previousStatus === 'hidden') {
      const isStaff = MODERATION_ROLES.includes(req.user.role);
      const moderatorOnOwnListing = isOwner && req.user.role === 'moderator';

      if (!isStaff || moderatorOnOwnListing) {
        return res.status(403).json({
          message: 'A hidden listing can only be restored by another moderator or an administrator'
        });
      }
    }
    // Returned and closed are terminal states: reopening them is an
    // administrative correction, not something the owner does by accident
    if (['returned', 'closed'].includes(previousStatus) && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(400).json({
        message: `A ${previousStatus} listing can only be reopened by an administrator`
      });
    }

    item.status = status;
    await item.save();

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
    if (!isOwner && !ADMIN_ROLES.includes(req.user.role)) {
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
