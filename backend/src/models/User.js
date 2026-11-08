const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [80, 'Name cannot exceed 80 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false // never returned in queries unless explicitly asked for
    },
    // superadmin  - everything, including who else is an administrator
    // admin       - users, listings, claims, reports
    // moderator   - reports and listing visibility only
    // faculty     - staff account, no administrative powers
    // student     - the default
    role: {
      type: String,
      enum: ['student', 'faculty', 'moderator', 'admin', 'superadmin'],
      default: 'student'
    },
    // Simple gamification: points are awarded when a return is completed
    points: { type: Number, default: 0, min: 0 },
    returns: { type: Number, default: 0, min: 0 },
    // Students may keep their name off the public leaderboard. Defaults to
    // false, so every existing account keeps its current visibility.
    leaderboardOptOut: { type: Boolean, default: false },
    // Email verification. Only used when EMAIL_VERIFICATION=enabled; accounts
    // created while it is disabled are verified immediately.
    emailVerified: { type: Boolean, default: false },
    // Faculty accounts stay pending until an administrator approves them
    pendingApproval: { type: Boolean, default: false },
    approvalNote: { type: String, trim: true, maxlength: 200 },
    // Set by an administrator when an account is misused. A suspended account
    // cannot log in or use any protected route.
    suspended: { type: Boolean, default: false },
    suspendedReason: { type: String, trim: true, maxlength: 200 },
    suspendedAt: { type: Date },
    // A temporary suspension clears itself when this moment passes
    suspendedUntil: { type: Date },
    // Only the hash of the token is stored, so a database leak cannot be used
    // to verify somebody else's address
    verificationTokenHash: { type: String, select: false },
    verificationTokenExpires: { type: Date, select: false },
    // Password reset. Only the hash is stored, exactly like verification.
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    // Bumped on every password reset. Tokens carry the value they were signed
    // with, so a reset silently logs out every older session.
    tokenVersion: { type: Number, default: 0 },
    // Ids of the point events already credited to this account. The credit
    // update is guarded on this list, which is what makes applying a credit
    // idempotent — a retry after a crash matches nothing and pays nothing.
    //
    // These markers are PERMANENT and are never pruned. A worker can be paused
    // for an unbounded time: it can hold a claim, lose its lease to another
    // worker, and only resume after that worker has finished. Removing a marker
    // would let that delayed or stale worker credit the same event a second
    // time. The array therefore grows by one id per award for the life of the
    // account — roughly 24 bytes each. That is the intended trade-off: do NOT
    // add automatic pruning, and do not treat this list as a short-lived cache.
    creditedEvents: { type: [String], default: [] },
    // Badges are earned once and keep the date they were awarded
    badges: [
      {
        id: { type: String, required: true },
        earnedAt: { type: Date, default: Date.now }
      }
    ]
  },
  { timestamps: true }
);

// Hash the password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = function (plainPassword) {
  return bcrypt.compare(plainPassword, this.password);
};

// Never expose the password hash to the client
userSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    points: this.points,
    returns: this.returns,
    leaderboardOptOut: Boolean(this.leaderboardOptOut),
    badges: (this.badges || []).map((b) => ({ id: b.id, earnedAt: b.earnedAt })),
    emailVerified: Boolean(this.emailVerified),
    pendingApproval: Boolean(this.pendingApproval),
    approvalNote: this.approvalNote || '',
    suspended: Boolean(this.suspended),
    suspendedUntil: this.suspendedUntil || null,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);
