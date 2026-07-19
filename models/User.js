const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
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
    currentPeriodEnd: Date
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

module.exports = mongoose.model('User', userSchema);
