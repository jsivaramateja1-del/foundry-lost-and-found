const express = require('express');
const mongoose = require('mongoose');
const Item = require('../models/Item');
const Claim = require('../models/Claim');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

/**
 * GET /api/admin/stats
 * Admin only. Counters plus chart-ready groupings.
 */
router.get('/stats', async (req, res, next) => {
  try {
    const [totalItems, totalLost, totalFound, totalReturned, totalClaims, totalUsers] =
      await Promise.all([
        Item.countDocuments(),
        Item.countDocuments({ type: 'lost' }),
        Item.countDocuments({ type: 'found' }),
        Item.countDocuments({ status: 'returned' }),
        Claim.countDocuments(),
        User.countDocuments()
      ]);

    const byCategory = await Item.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const byStatus = await Item.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Listings per day for the last 7 days (dashboard chart)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const perDay = await Item.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      totals: {
        items: totalItems,
        lost: totalLost,
        found: totalFound,
        returned: totalReturned,
        claims: totalClaims,
        users: totalUsers,
        open: totalItems - totalReturned
      },
      byCategory: byCategory.map((c) => ({ category: c._id, count: c.count })),
      byStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
      perDay: perDay.map((d) => ({ date: d._id, count: d.count }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/items
 * Admin only. Every listing, newest first.
 */
router.get('/items', async (req, res, next) => {
  try {
    const items = await Item.find()
      .populate('reportedBy', 'name email')
      .sort({ createdAt: -1 });
    res.status(200).json({
      count: items.length,
      items: items.map((i) => ({
        id: i._id, title: i.title, category: i.category, type: i.type,
        status: i.status, location: i.location, date: i.date,
        reportedBy: i.reportedBy ? { id: i.reportedBy._id, name: i.reportedBy.name, email: i.reportedBy.email } : null
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/claims
 * Admin only. Every claim, newest first.
 */
router.get('/claims', async (req, res, next) => {
  try {
    const claims = await Claim.find()
      .populate('claimant', 'name email')
      .populate('item', 'title type category status')
      .sort({ createdAt: -1 });
    res.status(200).json({
      count: claims.length,
      claims: claims.map((c) => ({
        id: c._id, status: c.status, message: c.message, createdAt: c.createdAt,
        claimant: c.claimant ? { id: c.claimant._id, name: c.claimant.name, email: c.claimant.email } : null,
        item: c.item
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users
 * Admin only. User list without password hashes.
 */
router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.status(200).json({ count: users.length, users: users.map((u) => u.toSafeObject()) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/items/:id/status
 * Admin only. Force any listing into a status.
 */
router.patch('/items/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['open', 'claimed', 'returned', 'closed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${allowed.join(', ')}` });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.status(200).json({ message: 'Status updated', item: { id: item._id, status: item.status } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
