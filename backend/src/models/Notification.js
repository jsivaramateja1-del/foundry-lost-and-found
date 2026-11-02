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
    // Where clicking the notification should take the reader
    link: { type: String, trim: true, default: '' },
    read: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// The dashboard asks for "my newest notifications" and "how many unread"
notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
