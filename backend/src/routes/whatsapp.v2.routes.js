/**
 * WhatsApp notification opt-in.
 *
 * Every route here is authenticated and acts only on the caller's own row —
 * there is no user id in any path or body, so one student can never read or
 * change another's number.
 */

const express = require('express');
const { protect } = require('../middleware/auth.v2');
const subs = require('../repositories/whatsapp');
const wa = require('../lib/whatsapp');

const router = express.Router();

/** Report whether this deployment can send at all, plus the caller's state. */
router.get('/', protect, async (req, res, next) => {
  try {
    const row = await subs.findForUser(req.user.id);
    res.json({
      available: wa.isConfigured(),
      subscribed: Boolean(row),
      phone: row ? row.phone : null
    });
  } catch (err) { next(err); }
});

router.post('/', protect, async (req, res, next) => {
  try {
    if (!wa.isConfigured()) {
      return res.status(503).json({
        message: 'WhatsApp notifications are not configured on this server'
      });
    }

    const raw = req.body && req.body.phone;
    const phone = wa.normalizePhone(raw);
    if (!phone) {
      return res.status(400).json({
        message: 'Enter a phone number with country code, for example 919876543210'
      });
    }

    if (await subs.phoneTakenByOther(phone, req.user.id)) {
      return res.status(409).json({
        message: 'That number is already registered to another account'
      });
    }

    const row = await subs.upsert(req.user.id, phone);
    res.status(201).json({ subscribed: true, phone: row.phone });
  } catch (err) { next(err); }
});

router.delete('/', protect, async (req, res, next) => {
  try {
    await subs.remove(req.user.id);
    res.json({ subscribed: false });
  } catch (err) { next(err); }
});

module.exports = router;
