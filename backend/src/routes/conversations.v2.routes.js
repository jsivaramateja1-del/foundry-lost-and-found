/**
 * Every conversation the signed-in user is part of.
 *
 * Mounted at /api/conversations. The per-item thread lives under
 * /api/items/:id/messages; this is the index that page needs when it is opened
 * from the nav rather than from a listing.
 */

const express = require('express');
const { protect } = require('../middleware/auth.v2');
const messages = require('../repositories/messages');

const router = express.Router();

router.get('/', protect, async (req, res, next) => {
  try {
    const rows = await messages.myConversations(req.user.id);
    res.json({ conversations: rows });
  } catch (err) { next(err); }
});

module.exports = router;
