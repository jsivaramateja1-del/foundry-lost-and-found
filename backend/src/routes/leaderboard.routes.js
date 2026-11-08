const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const PointEvent = require('../models/PointEvent');
const { assignRanks } = require('../utils/ranking');

const router = express.Router();

/** Rolling windows, in days, over the point ledger. */
const PERIOD_DAYS = { week: 7, month: 30 };
const PERIODS = ['week', 'month', 'all'];

/**
 * GET /api/leaderboard?period=week|month|all
 * Public. Students ranked by points from verified contributions.
 *
 * The all-time board reads the running total on the user document; the weekly
 * and monthly boards are date windows over PointEvent, which is why those
 * windows are honest rather than an approximation of a lifetime total.
 * Students who opted out are excluded entirely, and no email is ever returned.
 */
router.get('/', async (req, res, next) => {
  try {
    const period = String(req.query.period || 'all').toLowerCase();
    if (!PERIODS.includes(period)) {
      return res.status(400).json({ message: 'period must be one of: week, month, all' });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'The service is temporarily unavailable. Please try again shortly.' });
    }
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    if (period === 'all') {
      // The public board is for students. Staff accounts accumulate points
      // through moderation and must never appear here.
      const users = await User.find({
        points: { $gt: 0 },
        leaderboardOptOut: { $ne: true },
        role: 'student'
      })
        .sort({ points: -1 })
        .limit(limit)
        .select('name points returns');
      const board = assignRanks(users.map((u) => ({ name: u.name, points: u.points, returns: u.returns })));
      return res.status(200).json({ period, count: board.length, leaderboard: board });
    }

    const since = new Date(Date.now() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
    const rows = await PointEvent.aggregate([
      // Only credited events count. A pending or in-flight award is not a score.
      { $match: { createdAt: { $gte: since }, status: 'completed' } },
      {
        $group: {
          _id: '$user',
          points: { $sum: '$points' },
          returns: { $sum: { $cond: [{ $eq: ['$type', 'return'] }, 1, 0] } }
        }
      },
      { $sort: { points: -1 } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      // Same rules as the all-time board: students only, opt-outs excluded
      { $match: { 'user.leaderboardOptOut': { $ne: true }, 'user.role': 'student' } },
      { $limit: limit }
    ]);

    const board = assignRanks(rows.map((r) => ({
      name: r.user.name,
      points: r.points,
      returns: r.returns
    })));
    res.status(200).json({ period, count: board.length, leaderboard: board });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
