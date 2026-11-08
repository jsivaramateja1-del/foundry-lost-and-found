const express = require('express');
const mongoose = require('mongoose');
const CampusLocation = require('../models/CampusLocation');
const { protect, requireRole } = require('../middleware/auth');

const router = express.Router();

const dbDown = (res) => res.status(503).json({
  message: 'The service is temporarily unavailable. Please try again shortly.'
});

/**
 * GET /api/campus/locations
 * Public. Powers the Campus Explorer map and the location picker on the report
 * form. Returns an empty list when nothing is registered yet, which the frontend
 * shows as an explicit empty state rather than a blank map.
 */
router.get('/locations', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbDown(res);
    const locations = await CampusLocation.find().sort({ name: 1 }).lean();
    res.status(200).json({
      count: locations.length,
      locations: locations.map((l) => ({
        id: String(l._id), name: l.name, kind: l.kind, description: l.description,
        lat: l.lat, lng: l.lng, source: l.source
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/campus/locations
 * Administrator only. Adding a place is a data decision, not a user action, so
 * it is restricted and requires a source: a marker nobody can verify is a
 * fabricated marker.
 */
router.post('/locations', protect, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return dbDown(res);

    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const kind = typeof req.body.kind === 'string' ? req.body.kind.trim() : 'building';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const source = typeof req.body.source === 'string' ? req.body.source.trim() : '';
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (name.length < 2) return res.status(400).json({ message: 'name is required' });
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ message: 'lat must be a number between -90 and 90' });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'lng must be a number between -180 and 180' });
    }
    if (source.length < 3) {
      return res.status(400).json({ message: 'source is required: say where the coordinate came from' });
    }

    const existing = await CampusLocation.findOne({ name });
    if (existing) return res.status(409).json({ message: 'A location with that name already exists' });

    const created = await CampusLocation.create({
      name, kind, description, lat, lng, source, createdBy: req.user._id
    });
    res.status(201).json({
      location: {
        id: String(created._id), name: created.name, kind: created.kind,
        description: created.description, lat: created.lat, lng: created.lng, source: created.source
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
