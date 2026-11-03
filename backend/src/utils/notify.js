const Notification = require('../models/Notification');

/**
 * Create a notification, but never let it break the request that caused it.
 * A missing notification is annoying; a failed claim because the notification
 * insert threw would be much worse.
 *
 * The fourth argument is either a link string (the original signature) or an
 * options object: { link, relatedType, relatedId }.
 */
const notify = async (userId, type, message, target = '') => {
  const options = typeof target === 'string' ? { link: target } : (target || {});
  try {
    await Notification.create({
      user: userId,
      type,
      message,
      link: options.link || '',
      relatedType: options.relatedType || null,
      relatedId: options.relatedId || null
    });
  } catch (err) {
    console.error('Could not create notification:', err.message);
  }
};

module.exports = { notify };
