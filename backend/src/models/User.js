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
    verificationTokenExpires: { type: Date, select: false }
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
    emailVerified: Boolean(this.emailVerified),
    pendingApproval: Boolean(this.pendingApproval),
    approvalNote: this.approvalNote || '',
    suspended: Boolean(this.suspended),
    suspendedUntil: this.suspendedUntil || null,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);
