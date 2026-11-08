const mongoose = require('mongoose');

/**
 * One row per verified contribution.
 *
 * The unique { user, key } index is what makes an award idempotent: the same
 * event can be submitted any number of times and only the first insert wins.
 * Because every row is kept, the weekly and monthly leaderboards are simple
 * date windows over this collection rather than guesses about a running total.
 */
const pointEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['return', 'found_item', 'moderation'],
      required: true
    },
    points: { type: Number, required: true, min: 0 },
    // Stable identity of the event, e.g. "return:<itemId>:<userId>"
    key: { type: String, required: true },
    // pending   - the row exists, nobody is working on it
    // claimed   - one request holds a lease and is applying the credit
    // completed - the credit is on the account
    // The middle state is what makes a crash recoverable: an abandoned claim
    // expires and can be picked up again, instead of leaving a row that looks
    // finished but was never paid.
    status: {
      type: String,
      enum: ['pending', 'claimed', 'completed'],
      default: 'pending'
    },
    // When the current lease was taken. Reclaimable after the lease expires.
    claimedAt: { type: Date, default: null },
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
    claim: { type: mongoose.Schema.Types.ObjectId, ref: 'Claim' }
  },
  { timestamps: true }
);

pointEventSchema.index({ user: 1, key: 1 }, { unique: true });
pointEventSchema.index({ createdAt: -1 });
pointEventSchema.index({ status: 1, claimedAt: 1 });

module.exports = mongoose.model('PointEvent', pointEventSchema);
