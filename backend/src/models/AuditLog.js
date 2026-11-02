const mongoose = require('mongoose');

const AUDIT_ACTIONS = [
  'item_deleted',
  'item_status_changed',
  'user_role_changed',
  'user_suspended',
  'user_unsuspended',
  'report_resolved',
  'report_dismissed'
];

/**
 * A record of administrative actions.
 *
 * The actor's email is stored alongside the reference so the log still reads
 * sensibly if the account is ever removed.
 */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorEmail: { type: String, trim: true, lowercase: true },
    action: {
      type: String,
      enum: { values: AUDIT_ACTIONS, message: 'Unknown audit action' },
      required: true
    },
    targetType: { type: String, enum: ['item', 'user', 'claim', 'report'] },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    note: { type: String, trim: true, maxlength: 300 }
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
AuditLog.AUDIT_ACTIONS = AUDIT_ACTIONS;

module.exports = AuditLog;
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
