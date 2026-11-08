const express = require('express');
const mongoose = require('mongoose');
const Item = require('../models/Item');
const Claim = require('../models/Claim');
const User = require('../models/User');
const Report = require('../models/Report');
const AuditLog = require('../models/AuditLog');
const {
  protect, requireRole, ADMIN_ROLES, MODERATION_ROLES, SUPER_ROLES
} = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { awardPoints, evaluateBadges } = require('../utils/gamification');

const router = express.Router();

// Authentication first; each route then states which roles may call it.
router.use(protect);

/**
 * GET /api/admin/stats
 * Admin only. Counters plus chart-ready groupings.
 */
router.get('/stats', requireRole(...MODERATION_ROLES), async (req, res, next) => {
  try {
    const [totalItems, totalLost, totalFound, totalReturned, totalClaims, totalUsers, pendingClaims, openReports, suspendedUsers] =
      await Promise.all([
        Item.countDocuments(),
        Item.countDocuments({ type: 'lost' }),
        Item.countDocuments({ type: 'found' }),
        Item.countDocuments({ status: 'returned' }),
        Claim.countDocuments(),
        User.countDocuments(),
        Claim.countDocuments({ status: 'pending' }),
        Report.countDocuments({ status: 'open' }),
        User.countDocuments({ suspended: true })
      ]);

    const byCategory = await Item.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const byStatus = await Item.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Listings per day for the last 7 days (dashboard chart)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const perDay = await Item.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      totals: {
        items: totalItems,
        lost: totalLost,
        found: totalFound,
        returned: totalReturned,
        claims: totalClaims,
        pendingClaims,
        openReports,
        suspendedUsers,
        users: totalUsers,
        open: totalItems - totalReturned
      },
      byCategory: byCategory.map((c) => ({ category: c._id, count: c.count })),
      byStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
      perDay: perDay.map((d) => ({ date: d._id, count: d.count }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/items
 * Admin only. Every listing, newest first.
 */
router.get('/items', requireRole(...MODERATION_ROLES), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const itemFilter = req.user.role === 'moderator' ? { type: 'found' } : {};
    const total = await Item.countDocuments(itemFilter);

    const items = await Item.find(itemFilter)
      .populate('reportedBy', req.user.role === 'moderator' ? 'name' : 'name email')
      .populate('verifiedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.status(200).json({
      count: items.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      items: items.map((i) => ({
        id: i._id, title: i.title, category: i.category, type: i.type,
        status: i.status, location: i.location, date: i.date,
        verifiedAt: i.verifiedAt,
        verifiedBy: i.verifiedBy ? { id: i.verifiedBy._id, name: i.verifiedBy.name } : null,
        reportedBy: i.reportedBy ? { id: i.reportedBy._id, name: i.reportedBy.name, email: i.reportedBy.email } : null
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/items/:id/verify
 * Moderation staff verify genuine found listings before gamification rewards.
 */
router.patch('/items/:id/verify', requireRole(...MODERATION_ROLES), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }

    const item = await Item.findOneAndUpdate(
      {
        _id: req.params.id,
        type: 'found',
        status: { $ne: 'hidden' },
        verifiedAt: null
      },
      {
        $set: {
          verifiedAt: new Date(),
          verifiedBy: req.user._id
        }
      },
      { new: true, runValidators: true }
    );

    if (!item) {
      const current = await Item.findById(req.params.id).select('type status verifiedAt');
      if (!current) return res.status(404).json({ message: 'Listing not found' });
      if (current.type !== 'found') {
        return res.status(400).json({ message: 'Only found listings can be verified' });
      }
      if (current.status === 'hidden') {
        return res.status(400).json({ message: 'Hidden listings cannot be verified' });
      }
      if (current.verifiedAt) {
        return res.status(200).json({ message: 'Listing already verified', alreadyVerified: true });
      }
      return res.status(409).json({ message: 'Listing could not be verified; please retry' });
    }

    try {
      await awardPoints({
        userId: item.reportedBy,
        type: 'found_item',
        key: 'found:' + item._id,
        item: item._id
      });
    } catch (err) {
      console.error('Found-item points award failed after verification:', err.message);
    }

    try {
      await evaluateBadges(item.reportedBy);
    } catch (err) {
      console.error('Found-item badge evaluation failed after verification:', err.message);
    }

    try {
      await audit(req, 'item_found_verified', 'item', item._id, item.title);
    } catch (err) {
      console.error('Found-item verification audit failed:', err.message);
    }

    res.status(200).json({
      message: 'Found listing verified',
      verifiedAt: item.verifiedAt,
      verifiedBy: req.user._id
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/claims
 * Admin only. Every claim, newest first.
 */
router.get('/claims', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const total = await Claim.countDocuments();

    const claims = await Claim.find()
      .populate('claimant', 'name email')
      .populate('item', 'title type category status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.status(200).json({
      count: claims.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      claims: claims.map((c) => ({
        id: c._id, status: c.status, message: c.message, createdAt: c.createdAt,
        claimant: c.claimant ? { id: c.claimant._id, name: c.claimant.name, email: c.claimant.email } : null,
        item: c.item
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users
 * Admin only. User list without password hashes.
 */
router.get('/users', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.status(200).json({ count: users.length, users: users.map((u) => u.toSafeObject()) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/items/:id/status
 * Admin only. Change listing status, except returned.
 * A return must be confirmed through an approved claim handover.
 */
router.patch('/items/:id/status', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['open', 'claimed', 'returned', 'closed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${allowed.join(', ')}` });
    }
    if (status === 'returned') {
      return res.status(400).json({ message: 'A listing can only be marked returned after its approved claim handover is confirmed' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    await audit(req, 'item_status_changed', 'item', item._id, `status -> ${status}`);
    res.status(200).json({ message: 'Status updated', item: { id: item._id, status: item.status } });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/items/:id
 * Admin only. Removes a listing and every claim attached to it.
 */
router.delete('/items/:id', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid item id' });
    }
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    await Claim.deleteMany({ item: item._id });
    await Report.deleteMany({ item: item._id });
    await item.deleteOne();
    await audit(req, 'item_deleted', 'item', req.params.id, item.title);
    res.status(200).json({ message: 'Listing removed' });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/users/:id/role
 * Admin only. Promotes a student to admin, or demotes an admin back to student.
 * An admin cannot change their own role, so the last admin cannot lock
 * themselves out of the dashboard by accident.
 */
router.patch('/users/:id/role', requireRole(...SUPER_ROLES), async (req, res, next) => {
  try {
    const { role } = req.body;
    const assignable = ['student', 'faculty', 'moderator', 'admin', 'superadmin'];
    if (!assignable.includes(role)) {
      return res.status(400).json({ message: `role must be one of: ${assignable.join(', ')}` });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    if (String(req.user._id) === String(req.params.id)) {
      return res.status(400).json({ message: 'You cannot change your own role' });
    }

    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });

    await audit(req, 'user_role_changed', 'user', user._id, `${user.email} -> ${role}`);
    res.status(200).json({ message: `Role updated to ${role}`, user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/reports
 * Admin only. The moderation queue, newest first. Defaults to open reports.
 */
router.get('/reports', requireRole(...MODERATION_ROLES), async (req, res, next) => {
  try {
    const status = req.query.status || 'open';
    const filter = status === 'all' ? {} : { status };
    const reports = await Report.find(filter)
      .populate('item', 'title status type category location reportedBy')
      .populate('reportedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(100);

    res.status(200).json({
      count: reports.length,
      reports: reports.map((r) => ({
        id: r._id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        resolutionNote: r.resolutionNote,
        item: r.item
          ? { id: r.item._id, title: r.item.title, status: r.item.status, type: r.item.type, category: r.item.category }
          : null,
        reportedBy: r.reportedBy ? { id: r.reportedBy._id, name: r.reportedBy.name, email: r.reportedBy.email } : null
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/reports/:id
 * Admin only. Resolve or dismiss a report. Deleting the listing is a separate
 * decision, made with DELETE /api/admin/items/:id.
 */
router.patch('/reports/:id', requireRole(...MODERATION_ROLES), async (req, res, next) => {
  try {
    const { status, note } = req.body;
    if (!['resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ message: 'status must be either resolved or dismissed' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid report id' });
    }

    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    report.status = status;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    report.resolutionNote = String(note || '').trim();
    await report.save();

    await audit(req, status === 'resolved' ? 'report_resolved' : 'report_dismissed',
      'report', report._id, report.resolutionNote);

    res.status(200).json({ message: `Report ${status}`, report: { id: report._id, status: report.status } });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/users/:id/suspend
 * Admin only. Body: { suspended: true|false, reason }.
 * An admin cannot suspend themselves, and cannot suspend another admin: that
 * would let one compromised admin lock out the rest.
 */
router.patch('/users/:id/suspend', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { suspended, reason, durationDays } = req.body;
    if (typeof suspended !== 'boolean') {
      return res.status(400).json({ message: 'suspended must be true or false' });
    }
    const suspensionReason = String(reason || '').trim();
    if (suspended && suspensionReason.length > 200) {
      return res.status(400).json({ message: 'Suspension reason cannot exceed 200 characters' });
    }

    // 0, null or missing means permanent; temporary suspensions use whole days.
    let days = 0;
    if (suspended && durationDays !== undefined && durationDays !== null) {
      days = Number(durationDays);
      if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0 || days > 365) {
        return res.status(400).json({ message: 'durationDays must be a whole number between 0 and 365 (0 = permanent)' });
      }
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    if (String(req.user._id) === String(req.params.id)) {
      return res.status(400).json({ message: 'You cannot suspend your own account' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (['admin', 'superadmin'].includes(user.role)) {
      return res.status(400).json({ message: 'Administrator accounts cannot be suspended' });
    }

    user.suspended = suspended;
    user.suspendedReason = suspended ? suspensionReason : undefined;
    user.suspendedAt = suspended ? new Date() : undefined;
    user.suspendedUntil = suspended && days > 0
      ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      : undefined;
    await user.save();

    await audit(req, suspended ? 'user_suspended' : 'user_unsuspended',
      'user', user._id,
      suspended
        ? `${user.suspendedReason || user.email}${days > 0 ? ` (${days} days)` : ' (permanent)'}`
        : user.email);

    res.status(200).json({
      message: suspended
        ? (days > 0 ? `Account suspended for ${days} day(s)` : 'Account suspended permanently')
        : 'Account reinstated',
      user: user.toSafeObject()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/users/:id/approve
 * Admin only. Approves or rejects a pending (faculty) registration.
 * A rejection must say why, and the reason is shown to the applicant.
 */
router.patch('/users/:id/approve', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { approved, note } = req.body;
    if (typeof approved !== 'boolean') {
      return res.status(400).json({ message: 'approved must be true or false' });
    }
    if (!approved && !String(note || '').trim()) {
      return res.status(400).json({ message: 'A rejection must include a reason' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.pendingApproval) {
      return res.status(400).json({ message: 'This account is not waiting for approval' });
    }

    user.pendingApproval = false;
    user.approvalNote = approved
      ? String(note || 'Approved').trim()
      : String(note).trim();
    if (!approved) {
      // A rejected application cannot use the account at all
      user.suspended = true;
      user.suspendedReason = `Registration rejected: ${user.approvalNote}`;
      user.suspendedAt = new Date();
    }
    await user.save();

    await audit(req, approved ? 'user_approved' : 'user_rejected', 'user', user._id,
      `${user.email}${note ? ` - ${note}` : ''}`);

    res.status(200).json({
      message: approved ? 'Account approved' : 'Registration rejected',
      user: user.toSafeObject()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/audit
 * Admin only. The most recent administrative actions.
 */
router.get('/audit', requireRole(...MODERATION_ROLES), async (req, res, next) => {
  try {
    const entries = await AuditLog.find().sort({ createdAt: -1 }).limit(50);
    res.status(200).json({
      count: entries.length,
      entries: entries.map((e) => ({
        id: e._id,
        action: e.action,
        actor: e.actorEmail,
        targetType: e.targetType,
        targetId: e.targetId,
        note: e.note,
        createdAt: e.createdAt
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
