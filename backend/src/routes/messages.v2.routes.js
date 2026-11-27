const express = require('express');
const { protect } = require('../middleware/auth.v2');
const messages = require('../repositories/messages');

const router = express.Router({ mergeParams: true });

router.get('/', protect, async (req, res, next) => {
  try {
    const withId = typeof req.query.with === 'string' ? req.query.with : null;
    const audience = await messages.audienceFor(req.params.id, req.user.id);
    if (!audience) return res.status(404).json({ message: 'That listing does not exist' });

    const thread = await messages.threadFor(req.params.id, req.user.id, withId);
    if (thread === null) return res.status(403).json({ message: 'You cannot read this conversation' });

    const conversations = await messages.conversationsFor(req.params.id, req.user.id);
    await messages.markRead(req.params.id, req.user.id);

    await messages.touchPresence(req.user.id);

    res.json({
      messages: thread,
      isReporter: audience.isReporter,
      reporterId: audience.reporterId,
      conversations: conversations || [],
      otherTyping: await messages.typingOn(req.params.id, req.user.id),
      otherLastSeen: withId ? await messages.presenceOf(withId) : null
    });
  } catch (err) { next(err); }
});

router.post('/', protect, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await messages.send(req.params.id, req.user.id, body.recipientId, body.body, body.image);
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.status(201).json({ message: result.message });
  } catch (err) { next(err); }
});

router.post('/typing', protect, async (req, res, next) => {
  try {
    await messages.markTyping(req.params.id, req.user.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.delete('/:messageId', protect, async (req, res, next) => {
  try {
    const gone = await messages.removeOwn(req.params.messageId, req.user.id);
    if (!gone) return res.status(404).json({ message: 'That message is not yours to delete' });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
