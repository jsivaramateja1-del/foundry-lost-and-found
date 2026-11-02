const Notification = require('../models/Notification');

/**
 * Create a notification, but never let it break the request that caused it.
 * A missing notification is annoying; a failed claim because the notification
 * insert threw would be much worse.
 */
const notify = async (userId, type, message, link = '') => {
  try {
    await Notification.create({ user: userId, type, message, link });
  } catch (err) {
    console.error('Could not create notification:', err.message);
  }
};

module.exports = { notify };
