const AuditLog = require('../models/AuditLog');

/**
 * Record an administrative action.
 *
 * Like notifications, a failure here must never break the action itself:
 * losing an audit line is bad, failing the moderation decision because of it
 * is worse.
 */
const audit = async (req, action, targetType, targetId, note = '') => {
  try {
    await AuditLog.create({
      actor: req.user._id,
      actorEmail: req.user.email,
      action,
      targetType,
      targetId,
      note: String(note).slice(0, 300)
    });
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
};

module.exports = { audit };
