const express = require('express');
const Item = require('../models/Item');
const Claim = require('../models/Claim');
const PointEvent = require('../models/PointEvent');
const { protect } = require('../middleware/auth');
const { BADGES } = require('../utils/gamification');

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

    // Claims other people made on your listings — the number the dashboard
    // previously had to infer from a separate request per listing.
    const itemIds = items.map((i) => i._id);
    const [claimsReceived, pendingClaims] = itemIds.length
      ? await Promise.all([
          Claim.countDocuments({ item: { $in: itemIds } }),
          Claim.countDocuments({ item: { $in: itemIds }, status: 'pending' })
        ])
      : [0, 0];

    // Personal impact: the ledger is the source of truth, so these numbers
    // describe verified contributions only
    // Only completed events are contributions. A pending or in-flight award is
    // reported separately, so the summary never claims credit that has not
    // landed on the account.
    const [recentEvents, totalEvents, pendingEvents] = await Promise.all([
      PointEvent.find({ user: req.user._id, status: 'completed' })
        .sort({ createdAt: -1 }).limit(10).lean(),
      PointEvent.countDocuments({ user: req.user._id, status: 'completed' }),
      PointEvent.countDocuments({ user: req.user._id, status: { $in: ['pending', 'claimed'] } })
    ]);

    const earned = new Set((req.user.badges || []).map((b) => b.id));
    const badges = BADGES.map((b) => ({
      id: b.id,
      label: b.label,
      description: b.description,
      earned: earned.has(b.id),
      earnedAt: (req.user.badges || []).find((e) => e.id === b.id)?.earnedAt || null
    }));

    res.status(200).json({
      impact: {
        points: req.user.points,
        returns: req.user.returns,
        contributions: totalEvents,
        // Not yet credited: shown so a stuck award is visible, never counted
        pendingAwards: pendingEvents,
        badgesEarned: badges.filter((b) => b.earned).length,
        recent: recentEvents.map((e) => ({
          type: e.type,
          points: e.points,
          createdAt: e.createdAt
        }))
      },
      badges,
      stats: {
        listings: items.length,
        lost: items.filter((i) => i.type === 'lost').length,
        found: items.filter((i) => i.type === 'found').length,
        open: items.filter((i) => i.status === 'open').length,
        claimed: items.filter((i) => i.status === 'claimed').length,
        returned,
        claimsMade: claims.length,
        claimsReceived,
        pendingClaims,
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
