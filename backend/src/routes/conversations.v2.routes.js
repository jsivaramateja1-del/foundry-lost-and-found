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
