const mongoose = require('mongoose');
const { SYNC_RUN_STATUSES } = require('../services/analytics/metricStatus');

const providerSyncRunSchema = new mongoose.Schema(
  {
    syncRunId: { type: String, required: true, unique: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', default: null, index: true },
    publishJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'PublishJob', default: null, index: true },
    platform: {
      type: String,
      enum: ['bluesky', 'linkedin', 'x', 'facebook', 'instagram', 'threads', 'youtube', 'tiktok'],
      required: true,
      index: true
    },
    kind: { type: String, enum: ['post_metrics', 'account_metrics', 'backfill', 'reconciliation'], default: 'post_metrics' },
    status: { type: String, enum: SYNC_RUN_STATUSES, default: 'running', index: true },
    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date, default: null },
    windowStart: { type: Date, default: null },
    windowEnd: { type: Date, default: null },
    postsRequested: { type: Number, default: 0, min: 0 },
    postsFetched: { type: Number, default: 0, min: 0 },
    metricsFetched: { type: Number, default: 0, min: 0 },
    dataThrough: { type: Date, default: null },
    permissionStatus: {
      type: String,
      enum: ['ok', 'unknown', 'denied', 'insufficient_scope', 'not_applicable'],
      default: 'unknown'
    },
    tokenStatus: {
      type: String,
      enum: ['valid', 'unknown', 'expired', 'refresh_failed', 'reconnect_required', 'not_applicable'],
      default: 'unknown'
    },
    apiVersion: { type: String, default: '' },
    errorCode: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    nextRetryAt: { type: Date, default: null }
  },
  { timestamps: true }
);

providerSyncRunSchema.index({ projectId: 1, platform: 1, startedAt: -1 });
providerSyncRunSchema.index({ projectId: 1, accountId: 1, startedAt: -1 });
providerSyncRunSchema.index({ projectId: 1, status: 1, startedAt: -1 });

module.exports = mongoose.model('ProviderSyncRun', providerSyncRunSchema);
