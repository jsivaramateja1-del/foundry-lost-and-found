const mongoose = require('mongoose');

/**
 * An in-app notification.
 * Created by the server when something happens to you (a claim arrives, a
 * claim is reviewed, an item is marked returned). The frontend only ever
 * reads these — nothing is faked on the client.
 */
const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    // Short machine-readable kind, so the UI could style or group them later
    type: {
      type: String,
      enum: ['claim_received', 'claim_approved', 'claim_rejected', 'item_returned'],
      required: true
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: [300, 'Notification message cannot exceed 300 characters']
    },
    // Where clicking the notification should take the reader. The client
    // validates this against an allowlist before navigating, so a bad value
    // can never become an open redirect.
    link: { type: String, trim: true, default: '' },
    // What the notification is about, so the UI can point at the exact record
    relatedType: { type: String, enum: ['claim', 'item', 'account', null], default: null },
    relatedId: { type: mongoose.Schema.Types.ObjectId, default: null },
    read: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// The dashboard asks for "my newest notifications" and "how many unread"
notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
