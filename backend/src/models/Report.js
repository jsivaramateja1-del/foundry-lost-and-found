const mongoose = require('mongoose');

// Why a student might flag a listing
const REPORT_REASONS = ['spam', 'inappropriate', 'suspicious', 'incorrect', 'other'];

/**
 * A student's report about a listing. One report per student per listing:
 * a second attempt returns the existing report rather than piling up.
 */
const reportSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: [true, 'A report must point at a listing'],
      index: true
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    reason: {
      type: String,
      enum: { values: REPORT_REASONS, message: 'Invalid report reason' },
      required: [true, 'A reason is required']
    },
    details: {
      type: String,
      trim: true,
      maxlength: [500, 'Details cannot exceed 500 characters']
    },
    status: {
      type: String,
      enum: ['open', 'resolved', 'dismissed'],
      default: 'open',
      index: true
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    resolutionNote: { type: String, trim: true, maxlength: 300 }
  },
  { timestamps: true }
);

// One report per student per listing
reportSchema.index({ item: 1, reportedBy: 1 }, { unique: true });

const Report = mongoose.model('Report', reportSchema);
Report.REPORT_REASONS = REPORT_REASONS;

module.exports = Report;
module.exports.REPORT_REASONS = REPORT_REASONS;
