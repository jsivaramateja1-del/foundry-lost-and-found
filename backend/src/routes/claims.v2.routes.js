const express = require('express');
const crypto = require('crypto');
const claims = require('../repositories/claims');
const items = require('../repositories/items');
const { protect } = require('../middleware/auth.v2');
const mailer = require('../lib/brevo');
const users = require('../repositories/users');
const { claimIpLimit, claimAccountLimit } = require('../middleware/rateLimit');

const router = express.Router();

/** Six-digit handover code, derived from the claim id and the server secret. */
const handoverCode = (claimId) => {
  const h = crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev')
    .update(String(claimId)).digest('hex');
  return (parseInt(h.slice(0, 8), 16) % 900000 + 100000).toString();
};

router.post('/', claimIpLimit, protect, claimAccountLimit, async (req, res, next) => {
  try {
    const itemId = typeof req.body.item === 'string' ? req.body.item : '';
    const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 500) : '';

    const item = await items.findById(itemId);
    if (!item) return res.status(404).json({ message: 'Listing not found' });
    if (item.reportedBy === req.user.id) {
      return res.status(400).json({ message: 'You cannot claim your own listing' });
    }
    if (item.type !== 'found') {
      return res.status(400).json({ message: 'Only found items can be claimed' });
    }
    if (item.status !== 'open') {
      return res.status(409).json({ message: 'This listing is no longer open' });
    }

    const claim = await claims.create({ item: item.id, claimant: req.user.id, message });
    if (!claim) return res.status(409).json({ message: 'You have already claimed this item' });

    // Tell the finder someone has claimed their item. Fire-and-forget: a mail
    // outage must not undo a claim that is already stored.
    users.findById(item.reportedBy)
      .then((owner) => owner && mailer.send('itemClaimed', owner.email, {
        name: owner.name, title: item.title, link: `${process.env.APP_URL || ''}/dashboard.html`
      }))
      .catch(() => {});

    res.status(201).json({ claim });
  } catch (err) { next(err); }
});

/** The claimant's own claims. The handover code is only ever returned here. */
router.get('/mine', protect, async (req, res, next) => {
  try {
    const rows = await claims.findByClaimant(req.user.id);
    res.status(200).json({
      claims: rows.map((c) => ({
        ...c,
        handoverCode: c.status === 'approved' ? handoverCode(c.id) : undefined
      }))
    });
  } catch (err) { next(err); }
});

/** Claims received on the signed-in user's own listings. */
router.get('/received', protect, async (req, res, next) => {
  try {
    const own = await items.list({ reportedBy: req.user.id, includeHidden: true }, { limit: 50 });
    const all = [];
    for (const item of own.items) {
      const rows = await claims.findByItem(item.id);
      rows.forEach((c) => all.push({ ...c, itemTitle: item.title }));
    }
    res.status(200).json({ claims: all });
  } catch (err) { next(err); }
});

/** Owner approves or rejects. Approving auto-rejects siblings in one transaction. */
router.patch('/:id/review', claimIpLimit, protect, claimAccountLimit, async (req, res, next) => {
  try {
    const claim = await claims.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    const item = await items.findByIdRaw(claim.item);
    if (!item || item.reportedBy !== req.user.id) {
      return res.status(403).json({ message: 'Only the person who posted the item can review claims' });
    }

    const decision = req.body.decision;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be approve or reject' });
    }
    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 300) : '';

    const result = decision === 'approve'
      ? await claims.approve(claim.id, req.user.id, note)
      : await claims.reject(claim.id, req.user.id, note);

    if (result.error === 'not-found') return res.status(404).json({ message: 'Claim not found' });
    if (result.error === 'not-pending') return res.status(409).json({ message: 'That claim was already reviewed' });
    if (result.error === 'item-not-open') {
      return res.status(409).json({ message: 'That listing is no longer open for claims' });
    }

    // Tell the claimant the outcome. Only an approval needs the handover code
    // explained, so only an approval sends mail.
    if (decision === 'approve' && result.approved) {
      users.findById(claim.claimant)
        .then((claimant) => claimant && mailer.send('claimApproved', claimant.email, {
          name: claimant.name, title: item.title, link: `${process.env.APP_URL || ''}/dashboard.html`
        }))
        .catch(() => {});
    }

    const label = decision === 'approve' ? 'approved' : 'rejected';
    res.status(200).json({ message: `Claim ${label}`, ...result });
  } catch (err) { next(err); }
});

/** Owner enters the six-digit code to complete the handover. */
router.post('/:id/complete', claimIpLimit, protect, claimAccountLimit, async (req, res, next) => {
  try {
    const claim = await claims.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    const item = await items.findByIdRaw(claim.item);
    if (!item || item.reportedBy !== req.user.id) {
      return res.status(403).json({ message: 'Only the person who posted the item can complete the handover' });
    }

    const supplied = String(req.body.code || '').trim();
    const expected = handoverCode(claim.id);
    // Constant-time compare so the code cannot be discovered by timing.
    const a = Buffer.from(supplied.padEnd(6));
    const b = Buffer.from(expected.padEnd(6));
    const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

    const result = await claims.complete(claim.id, req.user.id, matches);
    if (result.error === 'bad-code') return res.status(400).json({ message: 'That handover code is not correct' });
    if (result.error === 'not-approved') return res.status(409).json({ message: 'That claim is not approved' });
    if (result.error === 'item-not-claimed') {
      return res.status(409).json({ message: 'That listing is not in a claimable state' });
    }
    if (result.error === 'not-found') return res.status(404).json({ message: 'Claim not found' });

    res.status(200).json({ message: 'Handover complete. The item is marked returned.', ...result });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.handoverCode = handoverCode;
