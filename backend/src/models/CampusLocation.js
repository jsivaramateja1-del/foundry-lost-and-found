/**
 * A named place on campus that a lost/found report can point at.
 *
 * Locations are stored rather than hardcoded so the university can add real
 * buildings without a code change. Only places someone can actually verify
 * belong here — no placeholder buildings.
 */
const mongoose = require('mongoose');

const campusLocationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    kind: {
      type: String,
      required: true,
      enum: ['building', 'gate', 'facility', 'landmark'],
      default: 'building'
    },
    description: { type: String, trim: true, maxlength: 400, default: '' },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    // Where the coordinate came from. A location with no source is a guess, and
    // a guess on a map is worse than no marker at all.
    source: { type: String, trim: true, maxlength: 300, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

campusLocationSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('CampusLocation', campusLocationSchema);
