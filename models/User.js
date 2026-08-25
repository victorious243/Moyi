const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    firstName: {
      type: String,
      trim: true,
      default: ''
    },
    lastName: {
      type: String,
      trim: true,
      default: ''
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true
    },
    googleSubject: {
      type: String,
      default: '',
      index: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    emailVerifiedAt: {
      type: Date,
      default: null
    },
    emailVerificationPinHash: {
      type: String,
      default: '',
      select: false
    },
    emailVerificationExpiresAt: {
      type: Date,
      default: null,
      select: false
    },
    emailVerificationRequestedAt: {
      type: Date,
      default: null
    },
    verificationReminderSentAt: {
      type: Date,
      default: null
    },
    verificationReminderCount: {
      type: Number,
      default: 0
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member'],
      default: 'owner'
    },
    stripeCustomerId: {
      type: String,
      default: '',
      index: true
    },
    stripeSubscriptionId: {
      type: String,
      default: '',
      index: true
    },
    plan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'agency'],
      default: 'free',
      index: true
    },
    subscriptionStatus: {
      type: String,
      default: 'inactive'
    },
    billingInterval: {
      type: String,
      enum: ['monthly', 'annual'],
      default: 'monthly'
    },
    currentPeriodEnd: Date,
    passwordResetTokenHash: {
      type: String,
      default: '',
      select: false
    },
    passwordResetPinHash: {
      type: String,
      default: '',
      select: false
    },
    passwordResetExpiresAt: {
      type: Date,
      default: null,
      select: false
    },
    passwordResetRequestedAt: {
      type: Date,
      default: null
    },
    passwordChangedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

userSchema.statics.createWithPassword = async function createWithPassword({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  return this.create({ name, email, passwordHash });
};

userSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.setPassword = async function setPassword(password) {
  this.passwordHash = await bcrypt.hash(password, 12);
  this.passwordChangedAt = new Date();
  this.passwordResetTokenHash = '';
  this.passwordResetPinHash = '';
  this.passwordResetExpiresAt = null;
  return this;
};

module.exports = mongoose.model('User', userSchema);
