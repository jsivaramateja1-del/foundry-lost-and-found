const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: [true, 'Item is required']
    },
    claimant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Claimant is required']
    },
    message: {
      type: String,
      required: [true, 'A short message is required so the finder can verify you'],
      trim: true,
      maxlength: [500, 'Message cannot exceed 500 characters']
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Why the claim was approved or rejected — kept as part of the history
    reviewNote: { type: String, trim: true, maxlength: 200 },
    reviewedAt: { type: Date },
    // Approving a claim only reserves the item. The handover is a separate,
    // deliberate step: that is what turns an item into "returned".
    handoverConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handoverConfirmedAt: { type: Date }
  },
  { timestamps: true }
);

// One claim per user per item - a second attempt returns a duplicate key error
claimSchema.index({ item: 1, claimant: 1 }, { unique: true });
// Makes "the other claims on this item" cheap when one is approved
claimSchema.index({ item: 1, status: 1 });

module.exports = mongoose.model('Claim', claimSchema);
