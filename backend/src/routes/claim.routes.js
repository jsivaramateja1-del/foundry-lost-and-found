const express = require('express');
const mongoose = require('mongoose');
const Claim = require('../models/Claim');
const Item = require('../models/Item');
const { protect } = require('../middleware/auth');
const { notify } = require('../utils/notify');

const router = express.Router();

const publicClaim = (doc) => {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: obj._id,
    item: obj.item,
    claimant: obj.claimant && obj.claimant.name
      ? { id: obj.claimant._id, name: obj.claimant.name }
      : obj.claimant,
    message: obj.message,
    status: obj.status,
    reviewedAt: obj.reviewedAt,
    createdAt: obj.createdAt
  };
};

/**
 * POST /api/claims
 * Protected. Submit a claim for an item.
 * Body: { itemId, message }
 */
router.post('/', protect, async (req, res, next) => {
  try {
    const { itemId, message } = req.body;

    if (!itemId) return res.status(400).json({ message: 'itemId is required' });
    if (!message || !String(message).trim()) {
      return res.status(400).json({ message: 'A short message is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }

    const item = await Item.findById(itemId);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    if (item.reportedBy.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot claim an item you reported yourself' });
    }
    if (item.status !== 'open') {
      return res.status(400).json({ message: `This item is already ${item.status}` });
    }

    const existing = await Claim.findOne({ item: itemId, claimant: req.user._id });
    if (existing) {
      return res.status(409).json({ message: 'You have already submitted a claim for this item' });
    }

    const claim = await Claim.create({
      item: itemId,
      claimant: req.user._id,
      message: String(message).trim()
    });

    // Tell the person who posted the listing that somebody is claiming it
    await notify(item.reportedBy, 'claim_received',
      `${req.user.name} has claimed "${item.title}". Review the claim from your dashboard.`,
      'dashboard.html');

    const populated = await claim.populate('claimant', 'name');
    res.status(201).json({ message: 'Claim submitted', claim: publicClaim(populated) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/claims/mine
 * Protected. Claims the logged-in user has made.
 */
router.get('/mine', protect, async (req, res, next) => {
  try {
    const claims = await Claim.find({ claimant: req.user._id })
      .populate('item', 'title category type status date location')
      .sort({ createdAt: -1 });
    res.status(200).json({ count: claims.length, claims: claims.map(publicClaim) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/claims/item/:itemId
 * Protected. Claims received on one of your listings (owner or admin).
 */
router.get('/item/:itemId', protect, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.itemId)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findById(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    const isOwner = item.reportedBy.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only view claims on your own listings' });
    }

    const claims = await Claim.find({ item: item._id })
      .populate('claimant', 'name')
      .sort({ createdAt: -1 });
    res.status(200).json({ count: claims.length, claims: claims.map(publicClaim) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/claims/:id
 * Protected. Owner of the item (or admin) approves or rejects a claim.
 * Body: { status: 'approved' | 'rejected' }
 */
router.patch('/:id', protect, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'status must be either approved or rejected' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid claim id' });
    }

    const claim = await Claim.findById(req.params.id).populate('item');
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    const item = claim.item;
    const isOwner = item.reportedBy.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the item owner or an admin can review claims' });
    }

    claim.status = status;
    claim.reviewedBy = req.user._id;
    claim.reviewedAt = new Date();
    await claim.save();

    // An approved claim moves the item out of the open pool
    if (status === 'approved') {
      await Item.findByIdAndUpdate(item._id, { status: 'claimed' });
    }

    // Tell the claimant what was decided
    await notify(claim.claimant, `claim_${status}`,
      status === 'approved'
        ? `Your claim on "${item.title}" was approved. Arrange the handover with the person who posted it.`
        : `Your claim on "${item.title}" was rejected.`,
      'dashboard.html');

    const populated = await claim.populate('claimant', 'name');
    res.status(200).json({ message: `Claim ${status}`, claim: publicClaim(populated) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
