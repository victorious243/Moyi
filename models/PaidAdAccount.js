const mongoose = require('mongoose');

const paidAdAccountSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    connectedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: ['google_ads', 'meta_ads', 'linkedin_ads', 'tiktok_ads'],
      required: true,
      index: true
    },
    externalAccountId: {
      type: String,
      required: true,
      trim: true
    },
    accountName: {
      type: String,
      trim: true,
      default: ''
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    timezone: {
      type: String,
      trim: true,
      default: 'UTC'
    },
    encryptedAccessToken: {
      type: String,
      required: true,
      select: false
    },
    encryptedRefreshToken: {
      type: String,
      default: '',
      select: false
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true
    },
    scopes: {
      type: [String],
      default: []
    },
    status: {
      type: String,
      enum: ['active', 'refresh_required', 'reconnect_required', 'disabled'],
      default: 'active',
      index: true
    },
    syncStatus: {
      type: String,
      enum: ['idle', 'syncing', 'succeeded', 'failed', 'rate_limited'],
      default: 'idle',
      index: true
    },
    lastSyncedAt: {
      type: Date,
      default: null
    },
    lastSyncError: {
      type: String,
      default: ''
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

paidAdAccountSchema.index(
  { projectId: 1, provider: 1, externalAccountId: 1 },
  { unique: true }
);
paidAdAccountSchema.index({ projectId: 1, status: 1, provider: 1 });

module.exports = mongoose.model('PaidAdAccount', paidAdAccountSchema);

