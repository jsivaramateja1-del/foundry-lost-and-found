const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

const router = express.Router();

const publicNotification = (doc) => ({
  id: doc._id,
  type: doc.type,
  message: doc.message,
  link: doc.link,
  read: doc.read,
  createdAt: doc.createdAt
});

/**
 * GET /api/notifications
 * Protected. Your newest notifications plus an unread count for the bell.
 */
router.get('/', protect, async (req, res, next) => {
  try {
    const [notifications, unread] = await Promise.all([
      Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20),
      Notification.countDocuments({ user: req.user._id, read: false })
    ]);
    res.status(200).json({
      unread,
      count: notifications.length,
      notifications: notifications.map(publicNotification)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/notifications/read-all
 * Protected. Marks everything as read.
 */
router.patch('/read-all', protect, async (req, res, next) => {
  try {
    const result = await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
    res.status(200).json({ message: 'All notifications marked as read', updated: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Protected. Marks one notification as read. You can only touch your own.
 */
router.patch('/:id/read', protect, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid notification id' });
    }
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    res.status(200).json({ message: 'Marked as read', notification: publicNotification(notification) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
