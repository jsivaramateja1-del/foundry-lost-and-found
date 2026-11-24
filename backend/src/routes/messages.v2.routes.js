/**
 * Item conversations.
 *
 * Mounted under /api/items/:id/messages. Every handler delegates authorisation
 * to the repository, which knows the difference between the reporter and a
 * claimant; a route-level check would drift from it.
 */

const express = require('express');
const { protect } = require('../middleware/auth.v2');
const messages = require('../repositories/messages');

const router = express.Router({ mergeParams: true });

router.get('/', protect, async (req, res, next) => {
  try {
    const thread = await messages.threadFor(req.params.id, req.user.id);
    if (thread === null) {
      return res.status(403).json({ message: 'You are not part of this conversation' });
    }
    const audience = await messages.audienceFor(req.params.id, req.user.id);
    await messages.markRead(req.params.id, req.user.id);
    res.json({
      messages: thread,
      isReporter: audience.isReporter,
      canMessage: audience.others
    });
  } catch (err) { next(err); }
});

router.post('/', protect, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await messages.send(
      req.params.id,
      req.user.id,
      body.recipientId,
      body.body
    );
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.status(201).json({ message: result.message });
  } catch (err) { next(err); }
});

module.exports = router;
