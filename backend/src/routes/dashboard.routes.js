const express = require('express');
const Item = require('../models/Item');
const Claim = require('../models/Claim');
const { protect } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/dashboard/me
 * Protected. The logged-in student's own listings, claims and counters.
 */
router.get('/me', protect, async (req, res, next) => {
  try {
    const [items, claims] = await Promise.all([
      Item.find({ reportedBy: req.user._id }).sort({ createdAt: -1 }),
      Claim.find({ claimant: req.user._id })
        .populate('item', 'title category type status date location')
        .sort({ createdAt: -1 })
    ]);

    const returned = items.filter((i) => i.status === 'returned').length;

    res.status(200).json({
      stats: {
        listings: items.length,
        lost: items.filter((i) => i.type === 'lost').length,
        found: items.filter((i) => i.type === 'found').length,
        open: items.filter((i) => i.status === 'open').length,
        claimed: items.filter((i) => i.status === 'claimed').length,
        returned,
        claimsMade: claims.length,
        points: req.user.points,
        successfulReturns: req.user.returns
      },
      items: items.map((i) => ({
        id: i._id, title: i.title, category: i.category, type: i.type,
        status: i.status, location: i.location, date: i.date
      })),
      claims: claims.map((c) => ({
        id: c._id, status: c.status, message: c.message, createdAt: c.createdAt, item: c.item
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
