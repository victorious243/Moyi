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
      enum: ['linkedin', 'x', 'facebook', 'instagram', 'youtube', 'tiktok', 'ayrshare', 'buffer', 'webhook'],
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
      default: ''
    },
    refreshToken: {
      type: String,
      default: ''
    },
    tokenExpiresAt: {
      type: Date,
      default: null
    },
    webhookUrl: {
      type: String,
      default: '',
      trim: true
    },
    webhookSecret: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'error'],
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
    }
  },
  { timestamps: true }
);

socialAccountSchema.index({ projectId: 1, platform: 1 });
socialAccountSchema.index({ userId: 1, platform: 1 });

module.exports = mongoose.model('SocialAccount', socialAccountSchema);
