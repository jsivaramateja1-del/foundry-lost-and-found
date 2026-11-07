
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_for_local_runs_only';
process.env.RATE_LIMIT_REPORTS_IP_MAX = '1000';
process.env.RATE_LIMIT_REPORTS_MAX = '1000';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../src/app');
const User = require('../src/models/User');
const mailer = require('../src/utils/mailer');
const Item = require('../src/models/Item');
const Report = require('../src/models/Report');
const Notification = require('../src/models/Notification');
const AuditLog = require('../src/models/AuditLog');

const { signToken } = require('../src/middleware/auth');
const { hashVerificationToken } = require('../src/utils/email');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`PASS: ${name}`);
  } else {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function createUser(email, role = 'student', extra = {}) {
  const user = await User.create({
    name: email.split('@')[0],
    email,
    password: 'secret123',
    role,
    emailVerified: true,
    ...extra
  });

  return {
    user,
    auth: { Authorization: `Bearer ${signToken(user._id, user.tokenVersion)}` }
  };
}

async function createItem(ownerId, title = 'Test Found Item') {
  return Item.create({
    title,
    description: 'A test item for route coverage.',
    category: 'Electronics',
    location: 'Library',
    date: new Date(),
    type: 'found',
    reportedBy: ownerId
  });
}

(async () => {
  let mongod;

  const originalVerificationSetting = process.env.EMAIL_VERIFICATION;

  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    await Promise.all([
      User.init(),
      Item.init(),
      Report.init(),
      Notification.init(),
      AuditLog.init()
    ]);

    const student = await createUser('coverage-student@scds.saiuniversity.edu.in');
    const other = await createUser('coverage-other@scds.saiuniversity.edu.in');
    const admin = await createUser('coverage-admin@scds.saiuniversity.edu.in', 'superadmin');
    const moderator = await createUser('coverage-mod@scds.saiuniversity.edu.in', 'moderator');

    // --------------------------------------------------
    // 1. Item reporting
    // --------------------------------------------------

    const item = await createItem(other.user._id);

    const report = await request(app)
      .post(`/api/items/${item._id}/report`)
      .set(student.auth)
      .send({ reason: 'suspicious', details: 'Please review this listing.' });

    check('Valid item report returns 201',
      report.status === 201 && report.body.report?.status === 'open');

    const duplicate = await request(app)
      .post(`/api/items/${item._id}/report`)
      .set(student.auth)
      .send({ reason: 'spam' });

    check('Duplicate item report returns 409', duplicate.status === 409);

    const invalidReason = await request(app)
      .post(`/api/items/${item._id}/report`)
      .set(other.auth)
      .send({ reason: 'invalid-reason' });

    check('Invalid report reason returns 400', invalidReason.status === 400);

    const ownItem = await createItem(student.user._id, 'Student Own Item');

    const ownReport = await request(app)
      .post(`/api/items/${ownItem._id}/report`)
      .set(student.auth)
      .send({ reason: 'other' });

    check('Cannot report own listing', ownReport.status === 400);

    const missingItem = await request(app)
      .post(`/api/items/${new mongoose.Types.ObjectId()}/report`)
      .set(student.auth)
      .send({ reason: 'other' });

    check('Reporting nonexistent item returns 404', missingItem.status === 404);

    const invalidItemId = await request(app)
      .post('/api/items/not-an-object-id/report')
      .set(student.auth)
      .send({ reason: 'other' });

    check('Invalid item ID returns 400', invalidItemId.status === 400);

    // --------------------------------------------------
    // 2. Notifications
    // --------------------------------------------------

    const notification1 = await Notification.create({
      user: student.user._id,
      type: 'claim_received',
      message: 'A new claim was received.',
      link: '/dashboard',
      relatedType: 'item'
    });

    const notification2 = await Notification.create({
      user: student.user._id,
      type: 'item_returned',
      message: 'Your item was returned.',
      read: true
    });

    const otherNotification = await Notification.create({
      user: other.user._id,
      type: 'claim_approved',
      message: 'Your claim was approved.'
    });

    const notificationList = await request(app)
      .get('/api/notifications')
      .set(student.auth);

    check('Notification list returns 200',
      notificationList.status === 200 &&
      notificationList.body.count === 2 &&
      notificationList.body.unread === 1);

    check('Notification list does not expose another user notification',
      !notificationList.body.notifications.some(
        n => String(n.id) === String(otherNotification._id)
      ));

    const markOne = await request(app)
      .patch(`/api/notifications/${notification1._id}/read`)
      .set(student.auth);

    check('Mark own notification as read returns 200',
      markOne.status === 200 && markOne.body.notification.read === true);

    const markOther = await request(app)
      .patch(`/api/notifications/${otherNotification._id}/read`)
      .set(student.auth);

    check('Cannot mark another user notification as read',
      markOther.status === 404);

    const invalidNotificationId = await request(app)
      .patch('/api/notifications/invalid-id/read')
      .set(student.auth);

    check('Invalid notification ID returns 400',
      invalidNotificationId.status === 400);

    const readAll = await request(app)
      .patch('/api/notifications/read-all')
      .set(student.auth);

    check('Mark all notifications as read returns 200',
      readAll.status === 200 && readAll.body.updated === 0);

    const finalNotificationList = await request(app)
      .get('/api/notifications')
      .set(student.auth);

    check('Read-all leaves zero unread notifications',
      finalNotificationList.status === 200 &&
      finalNotificationList.body.unread === 0);

    check('Notifications require authentication',
      (await request(app).get('/api/notifications')).status === 401);

    // --------------------------------------------------
    // 3. Admin report moderation
    // --------------------------------------------------

    const adminQueue = await request(app)
      .get('/api/admin/reports')
      .set(admin.auth);

    check('Admin can view report queue',
      adminQueue.status === 200 &&
      adminQueue.body.reports.some(r => String(r.id) === String(report.body.report.id)));

    const moderatorQueue = await request(app)
      .get('/api/admin/reports')
      .set(moderator.auth);

    check('Moderator can view report queue', moderatorQueue.status === 200);

    const studentQueue = await request(app)
      .get('/api/admin/reports')
      .set(student.auth);

    check('Student cannot view report queue', studentQueue.status === 403);

    const resolved = await request(app)
      .patch(`/api/admin/reports/${report.body.report.id}`)
      .set(admin.auth)
      .send({ status: 'resolved', note: 'Reviewed by test administrator.' });

    check('Admin can resolve a report',
      resolved.status === 200 && resolved.body.report.status === 'resolved');

    const savedReport = await Report.findById(report.body.report.id);

    check('Resolved report records reviewer and timestamp',
      savedReport &&
      String(savedReport.reviewedBy) === String(admin.user._id) &&
      savedReport.reviewedAt instanceof Date);

    const invalidResolution = await request(app)
      .patch(`/api/admin/reports/${report.body.report.id}`)
      .set(admin.auth)
      .send({ status: 'open' });

    check('Invalid report moderation status returns 400',
      invalidResolution.status === 400);

    const missingReport = await request(app)
      .patch(`/api/admin/reports/${new mongoose.Types.ObjectId()}`)
      .set(admin.auth)
      .send({ status: 'dismissed' });

    check('Missing report returns 404', missingReport.status === 404);

    // --------------------------------------------------
    // 4. User approval and rejection
    // --------------------------------------------------

    const approvalUser = await createUser(
      'coverage-approval@scds.saiuniversity.edu.in',
      'faculty',
      { pendingApproval: true }
    );

    const approval = await request(app)
      .patch(`/api/admin/users/${approvalUser.user._id}/approve`)
      .set(admin.auth)
      .send({ approved: true, note: 'Approved for testing.' });

    check('Admin can approve pending account', approval.status === 200);

    const approvedUser = await User.findById(approvalUser.user._id);

    check('Approval clears pendingApproval',
      approvedUser && approvedUser.pendingApproval === false);

    const rejectionUser = await createUser(
      'coverage-rejection@scds.saiuniversity.edu.in',
      'faculty',
      { pendingApproval: true }
    );

    const missingRejectionReason = await request(app)
      .patch(`/api/admin/users/${rejectionUser.user._id}/approve`)
      .set(admin.auth)
      .send({ approved: false });

    check('Rejection without reason returns 400',
      missingRejectionReason.status === 400);

    const rejection = await request(app)
      .patch(`/api/admin/users/${rejectionUser.user._id}/approve`)
      .set(admin.auth)
      .send({ approved: false, note: 'Unable to verify eligibility.' });

    check('Admin can reject pending account', rejection.status === 200);

    const rejectedUser = await User.findById(rejectionUser.user._id);

    check('Rejected account is suspended',
      rejectedUser &&
      rejectedUser.pendingApproval === false &&
      rejectedUser.suspended === true);

    const studentApprovalAttempt = await request(app)
      .patch(`/api/admin/users/${rejectionUser.user._id}/approve`)
      .set(student.auth)
      .send({ approved: true });

    check('Student cannot approve accounts',
      studentApprovalAttempt.status === 403);

    // --------------------------------------------------
    // 5. Role management
    // --------------------------------------------------

    const roleTarget = await createUser(
      'coverage-role@scds.saiuniversity.edu.in'
    );

    const roleChange = await request(app)
      .patch(`/api/admin/users/${roleTarget.user._id}/role`)
      .set(admin.auth)
      .send({ role: 'moderator' });

    check('Superadmin can change another user role',
      roleChange.status === 200 &&
      roleChange.body.user.role === 'moderator');

    const invalidRole = await request(app)
      .patch(`/api/admin/users/${roleTarget.user._id}/role`)
      .set(admin.auth)
      .send({ role: 'owner' });

    check('Invalid role assignment returns 400', invalidRole.status === 400);

    const selfRoleChange = await request(app)
      .patch(`/api/admin/users/${admin.user._id}/role`)
      .set(admin.auth)
      .send({ role: 'student' });

    check('Administrator cannot change own role',
      selfRoleChange.status === 400);

    const moderatorRoleChange = await request(app)
      .patch(`/api/admin/users/${roleTarget.user._id}/role`)
      .set(moderator.auth)
      .send({ role: 'student' });

    check('Moderator cannot change user roles',
      moderatorRoleChange.status === 403);

    // --------------------------------------------------
    // 6. Audit log
    // --------------------------------------------------

    const auditResponse = await request(app)
      .get('/api/admin/audit')
      .set(admin.auth);

    check('Admin can view audit log',
      auditResponse.status === 200 &&
      Array.isArray(auditResponse.body.entries));

    const auditActions = await AuditLog.find({
      action: { $in: ['report_resolved', 'user_approved', 'user_rejected', 'user_role_changed'] }
    });

    check('Administrative actions create audit records',
      auditActions.length >= 4);

    const studentAudit = await request(app)
      .get('/api/admin/audit')
      .set(student.auth);

    check('Student cannot view audit log', studentAudit.status === 403);

    // --------------------------------------------------
    // 7. Email verification and logout
    // --------------------------------------------------

    process.env.EMAIL_VERIFICATION = 'enabled';

    const verificationToken = 'coverage-verification-token';
    const verificationUser = await createUser(
      'coverage-verify@scds.saiuniversity.edu.in',
      'student',
      {
        emailVerified: false,
        verificationTokenHash: hashVerificationToken(verificationToken),
        verificationTokenExpires: new Date(Date.now() + 60 * 60 * 1000)
      }
    );

    const verified = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: verificationToken });

    check('Valid email verification token returns 200',
      verified.status === 200 && verified.body.user.emailVerified === true);

    const reusedToken = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: verificationToken });

    check('Verification token cannot be reused', reusedToken.status === 400);

    const expiredUser = await createUser(
      'coverage-expired@scds.saiuniversity.edu.in',
      'student',
      {
        emailVerified: false,
        verificationTokenHash: hashVerificationToken('expired-token'),
        verificationTokenExpires: new Date(Date.now() - 1000)
      }
    );

    const expiredVerification = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'expired-token' });

    check('Expired verification token returns 400',
      expiredVerification.status === 400);

    const emptyVerification = await request(app)
      .post('/api/auth/verify-email')
      .send({});

    check('Missing verification token returns 400',
      emptyVerification.status === 400);

    const resend = await request(app)
      .post('/api/auth/resend-verification')
      .set(verificationUser.auth);

    check('Resend verification returns 400 when already verified',
      resend.status === 400);
    // 8. Resend verification success, failure and disabled configuration
    const originalSendVerificationEmail = mailer.sendVerificationEmail;

    try {
      process.env.EMAIL_VERIFICATION = 'enabled';

      // Test successful email delivery using a stub.
      let capturedEmail = null;
      let capturedToken = null;

      mailer.sendVerificationEmail = async (to, token) => {
        capturedEmail = to;
        capturedToken = token;
      };

      const resendSuccessUser = await createUser(
        'coverage-resend-success@scds.saiuniversity.edu.in',
        'student',
        { emailVerified: false }
      );

      const resendSuccess = await request(app)
        .post('/api/auth/resend-verification')
        .set(resendSuccessUser.auth);

      const savedResendUser = await User.findById(resendSuccessUser.user._id)
        .select('+verificationTokenHash +verificationTokenExpires');

      check('Unverified user can successfully resend verification',
        resendSuccess.status === 200);

      check('Successful resend sends email to correct address',
        capturedEmail === resendSuccessUser.user.email);

      check('Successful resend saves matching hashed token and expiry',
        Boolean(capturedToken) &&
        savedResendUser &&
        savedResendUser.verificationTokenHash === hashVerificationToken(capturedToken) &&
        savedResendUser.verificationTokenExpires > new Date());

      // Test email delivery failure and token cleanup.
      mailer.sendVerificationEmail = async () => {
        throw new Error('Simulated email delivery failure');
      };

      const resendFailureUser = await createUser(
        'coverage-resend-failure@scds.saiuniversity.edu.in',
        'student',
        { emailVerified: false }
      );

      const resendFailure = await request(app)
        .post('/api/auth/resend-verification')
        .set(resendFailureUser.auth);

      const cleanedUser = await User.findById(resendFailureUser.user._id)
        .select('+verificationTokenHash +verificationTokenExpires');

      check('Email delivery failure returns 502',
        resendFailure.status === 502);

      check('Failed email delivery removes verification token',
        cleanedUser &&
        !cleanedUser.verificationTokenHash &&
        !cleanedUser.verificationTokenExpires);

      // Test disabled verification configuration.
      process.env.EMAIL_VERIFICATION = 'disabled';

      const disabledUser = await createUser(
        'coverage-resend-disabled@scds.saiuniversity.edu.in',
        'student',
        { emailVerified: false }
      );

      const disabledResend = await request(app)
        .post('/api/auth/resend-verification')
        .set(disabledUser.auth);

      check('Resend verification is rejected when feature is disabled',
        disabledResend.status === 400);

    } finally {
      mailer.sendVerificationEmail = originalSendVerificationEmail;
    }

    const logout = await request(app)
      .post('/api/auth/logout')
      .set(student.auth);

    check('Logout endpoint returns 200', logout.status === 200);

    const logoutNoToken = await request(app)
      .post('/api/auth/logout');

    check('Logout requires authentication', logoutNoToken.status === 401);

    // --------------------------------------------------
    // Final results
    // --------------------------------------------------

  } catch (error) {
    failed++;
    console.error('TEST SUITE ERROR:', error);
  } finally {
    if (originalVerificationSetting === undefined) {
      delete process.env.EMAIL_VERIFICATION;
    } else {
      process.env.EMAIL_VERIFICATION = originalVerificationSetting;
    }

    await mongoose.disconnect();

    if (mongod) {
      await mongod.stop();
    }

    console.log('\n================================');
    console.log(`Coverage tests passed: ${passed}`);
    console.log(`Coverage tests failed: ${failed}`);
    console.log('================================');

    process.exitCode = failed === 0 ? 0 : 1;
  }
})();
