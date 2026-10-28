const express = require('express');
const User = require('../models/User');

const router = express.Router();

/**
 * GET /api/leaderboard
 * Public. Light gamification: students ranked by points earned on returns.
 */
router.get('/', async (req, res, next) => {
  try {
    const users = await User.find({ points: { $gt: 0 } })
      .sort({ points: -1 })
      .limit(10)
      .select('name points returns');
    res.status(200).json({
      count: users.length,
      leaderboard: users.map((u, i) => ({
        rank: i + 1,
        name: u.name,
        points: u.points,
        returns: u.returns
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
