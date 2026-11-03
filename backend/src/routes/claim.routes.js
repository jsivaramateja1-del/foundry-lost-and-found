const express = require('express');
const mongoose = require('mongoose');
const Claim = require('../models/Claim');
const Item = require('../models/Item');
const { protect, requireVerified } = require('../middleware/auth');
const { notify } = require('../utils/notify');
const { supportsTransactions } = require('../utils/transactions');
const { claimIpLimit, claimAccountLimit } = require('../middleware/rateLimit');

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
    handoverConfirmedAt: obj.handoverConfirmedAt || null,
    createdAt: obj.createdAt
  };
};

/**
 * POST /api/claims
 * Protected. Submit a claim for an item.
 * Body: { itemId, message }
 */
router.post('/', claimIpLimit, protect, claimAccountLimit, requireVerified, async (req, res, next) => {
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
      { link: 'dashboard.html#claims-received', relatedType: 'claim', relatedId: claim._id });

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
 * GET /api/claims/received
 * Protected. Every claim made on any of your listings, in one query.
 *
 * The dashboard used to call /claims/item/:id once per listing and swallow
 * any error, which meant a failure looked like "no claims". One query cannot
 * fail per item, and the dashboard now shows the error if it does fail.
 */
router.get('/received', protect, async (req, res, next) => {
  try {
    const items = await Item.find({ reportedBy: req.user._id }).select('_id title');
    const byId = new Map(items.map((i) => [String(i._id), i.title]));

    const claims = items.length
      ? await Claim.find({ item: { $in: items.map((i) => i._id) } })
          .populate('claimant', 'name')
          .sort({ createdAt: -1 })
      : [];

    res.status(200).json({
      count: claims.length,
      claims: claims.map((c) => ({
        ...publicClaim(c),
        itemTitle: byId.get(String(c.item)) || 'Listing removed'
      }))
    });
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

    // ---------- rejection: one document, no coordination needed ----------
    if (status === 'rejected') {
      claim.status = 'rejected';
      claim.reviewedBy = req.user._id;
      claim.reviewedAt = new Date();
      claim.reviewNote = String(req.body.note || '').slice(0, 200) || undefined;
      await claim.save();

      await notify(claim.claimant, 'claim_rejected',
        `Your claim on "${item.title}" was rejected.`,
        { link: 'dashboard.html#claims-made', relatedType: 'claim', relatedId: claim._id });

      const populatedReject = await claim.populate('claimant', 'name');
      return res.status(200).json({ message: 'Claim rejected', claim: publicClaim(populatedReject) });
    }

    // ---------- approval: three writes that must agree ----------
    // 1. the item leaves the open pool — a conditional single-document update,
    //    which is atomic on its own and is what actually stops two claims being
    //    approved at the same moment
    // 2. this claim becomes approved
    // 3. every other pending claim on the item is rejected
    const siblingNote = 'Another claim was approved for this listing.';

    const approve = async (session) => {
      const opts = session ? { session } : {};
      const claimed = await Item.findOneAndUpdate(
        { _id: item._id, status: 'open' },
        { $set: { status: 'claimed' } },
        { new: true, ...opts }
      );
      if (!claimed) return null; // somebody else got there first

      claim.status = 'approved';
      claim.reviewedBy = req.user._id;
      claim.reviewedAt = new Date();
      claim.reviewNote = String(req.body.note || '').slice(0, 200) || undefined;
      await claim.save(opts);

      const siblings = await Claim.find({
        item: item._id,
        _id: { $ne: claim._id },
        status: 'pending'
      }).select('_id claimant');

      if (siblings.length) {
        await Claim.updateMany(
          { _id: { $in: siblings.map((s) => s._id) } },
          {
            $set: {
              status: 'rejected',
              reviewedBy: req.user._id,
              reviewedAt: new Date(),
              reviewNote: siblingNote
            }
          },
          opts
        );
      }
      return siblings;
    };

    let siblings = null;
    if (await supportsTransactions()) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          siblings = await approve(session);
          // Throwing aborts the transaction, so nothing is half-written
          if (siblings === null) throw Object.assign(new Error('conflict'), { isConflict: true });
        });
      } catch (err) {
        if (err.isConflict) {
          return res.status(409).json({
            message: 'Another claim on this listing has already been approved.'
          });
        }
        throw err;
      } finally {
        await session.endSession();
      }
    } else {
      // No transactions available: the conditional item update is the guard.
      // If a later write fails, put the item back so the listing is not stuck
      // as "claimed" with no approved claim.
      try {
        siblings = await approve(null);
      } catch (err) {
        await Item.updateOne({ _id: item._id, status: 'claimed' }, { $set: { status: 'open' } });
        throw err;
      }
      if (siblings === null) {
        return res.status(409).json({
          message: 'Another claim on this listing has already been approved.'
        });
      }
    }

    // Notifications are deliberately outside the transaction: a failed
    // notification must never roll back a completed approval.
    await notify(claim.claimant, 'claim_approved',
      `Your claim on "${item.title}" was approved. Arrange the handover with the person who posted it.`,
      { link: 'dashboard.html#claims-made', relatedType: 'claim', relatedId: claim._id });

    for (const sibling of siblings || []) {
      await notify(sibling.claimant, 'claim_rejected',
        `Your claim on "${item.title}" was rejected: ${siblingNote.toLowerCase()}`,
        { link: 'dashboard.html#claims-made', relatedType: 'claim', relatedId: sibling._id });
    }

    const populated = await claim.populate('claimant', 'name');
    res.status(200).json({
      message: 'Claim approved',
      claim: publicClaim(populated),
      rejectedSiblings: (siblings || []).length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/claims/:id/handover
 * Protected. The item owner (or an admin) confirms the item actually changed
 * hands. Only then does the listing become "returned" and the points are paid.
 *
 * Approving a claim deliberately does NOT do this: approving only reserves the
 * item so nobody else can claim it.
 */
router.post('/:id/handover', protect, async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid claim id' });
    }

    const claim = await Claim.findById(req.params.id).populate('item');
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    if (!claim.item) return res.status(404).json({ message: 'The listing for this claim no longer exists' });

    const item = claim.item;
    const isOwner = item.reportedBy.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the item owner or an admin can confirm a handover' });
    }
    if (claim.status !== 'approved') {
      return res.status(400).json({ message: 'Approve the claim before confirming the handover' });
    }
    if (claim.handoverConfirmedAt) {
      return res.status(400).json({ message: 'This handover has already been confirmed' });
    }
    if (item.status === 'returned') {
      return res.status(400).json({ message: 'This listing is already marked as returned' });
    }

    // Conditional transition: two simultaneous confirmations cannot both win
    const completed = await Item.findOneAndUpdate(
      { _id: item._id, status: 'claimed' },
      { $set: { status: 'returned' } },
      { new: true }
    );
    if (!completed) {
      return res.status(409).json({ message: 'This listing is no longer awaiting a handover' });
    }

    claim.handoverConfirmedBy = req.user._id;
    claim.handoverConfirmedAt = new Date();
    await claim.save();

    // Both sides of a completed return earn the points, once
    const User = require('../models/User');
    await User.findByIdAndUpdate(item.reportedBy, { $inc: { points: 10, returns: 1 } });
    await User.findByIdAndUpdate(claim.claimant, { $inc: { points: 10, returns: 1 } });

    await notify(item.reportedBy, 'item_returned',
      `Handover confirmed for "${item.title}". The listing is now marked returned.`,
      { link: 'dashboard.html#claims-received', relatedType: 'item', relatedId: item._id });
    await notify(claim.claimant, 'item_returned',
      `The handover for "${item.title}" is confirmed. Thanks for closing the loop.`,
      { link: 'dashboard.html#claims-made', relatedType: 'claim', relatedId: claim._id });

    res.status(200).json({
      message: 'Handover confirmed. The listing is now marked as returned.',
      claim: publicClaim(claim)
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
