const mongoose = require('mongoose');

const socialOAuthSessionSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ['bluesky'],
      required: true,
      index: true
    },
    kind: {
      type: String,
      enum: ['state', 'session', 'lock'],
      required: true,
      index: true
    },
    key: {
      type: String,
      required: true
    },
    encryptedPayload: {
      type: String,
      required: true,
      select: false
    },
    expiresAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

socialOAuthSessionSchema.index({ platform: 1, kind: 1, key: 1 }, { unique: true });
socialOAuthSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } }
);

module.exports = mongoose.model('SocialOAuthSession', socialOAuthSessionSchema);
