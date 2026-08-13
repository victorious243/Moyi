const mongoose = require('mongoose');

const socialAccountSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    platform: {
      type: String,
      enum: ['bluesky', 'linkedin', 'x', 'facebook', 'instagram', 'threads', 'youtube', 'tiktok', 'ayrshare', 'buffer', 'webhook'],
      required: true,
      index: true
    },
    accountName: {
      type: String,
      required: true,
      trim: true
    },
    externalAccountId: {
      type: String,
      default: '',
      trim: true
    },
    accessToken: {
      type: String,
      default: '',
      select: false
    },
    refreshToken: {
      type: String,
      default: '',
      select: false
    },
    tokenExpiresAt: {
      type: Date,
      default: null
    },
    tokenRefreshLockedUntil: {
      type: Date,
      default: null,
      select: false
    },
    scopes: [{
      type: String,
      trim: true
    }],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    webhookUrl: {
      type: String,
      default: '',
      trim: true
    },
    webhookSecret: {
      type: String,
      default: '',
      select: false
    },
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'error', 'reconnect_required'],
      default: 'connected',
      index: true
    },
    statusMessage: {
      type: String,
      default: ''
    },
    lastSyncAt: {
      type: Date,
      default: Date.now
    },
    reconnectRequiredAt: {
      type: Date,
      default: null,
      index: true
    },
    metricsStatus: {
      type: String,
      enum: ['pending', 'active', 'limited', 'unsupported', 'error'],
      default: 'pending',
      index: true
    },
    metricsStatusMessage: {
      type: String,
      default: ''
    },
    lastMetricsSyncAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

socialAccountSchema.index({ projectId: 1, platform: 1 });
socialAccountSchema.index({ userId: 1, platform: 1 });
socialAccountSchema.index({ status: 1, tokenExpiresAt: 1 });

module.exports = mongoose.model('SocialAccount', socialAccountSchema);
