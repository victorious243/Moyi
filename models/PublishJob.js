const mongoose = require('mongoose');

const publishJobSchema = new mongoose.Schema(
  {
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PublishBatch',
      required: true,
      index: true
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    destinationProjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialDraft',
      required: true,
      index: true
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialAccount',
      required: true,
      index: true
    },
    platform: {
      type: String,
      enum: ['bluesky', 'linkedin', 'x', 'facebook', 'instagram', 'threads', 'youtube', 'tiktok', 'email', 'ayrshare', 'buffer', 'webhook'],
      required: true,
      index: true
    },
    content: {
      title: { type: String, default: '' },
      body: { type: String, default: '' },
      firstComment: { type: String, default: '' },
      imageUrl: { type: String, default: '' },
      imageAlt: { type: String, default: '' }
    },
    mediaIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MediaAsset'
    }],
    publishOptions: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    scheduledAt: {
      type: Date,
      default: null,
      index: true
    },
    status: {
      type: String,
      enum: ['queued', 'preparing_media', 'publishing', 'provider_processing', 'retry_wait', 'published', 'failed', 'dead_letter', 'cancelled', 'expired'],
      default: 'queued',
      index: true
    },
    attempts: {
      type: Number,
      default: 0
    },
    manualRetryCount: {
      type: Number,
      default: 0
    },
    maxAttempts: {
      type: Number,
      default: 4,
      min: 1,
      max: 12
    },
    nextRetryAt: {
      type: Date,
      default: null,
      index: true
    },
    lastAttemptAt: {
      type: Date,
      default: null
    },
    providerDispatchStartedAt: {
      type: Date,
      default: null
    },
    failureKind: {
      type: String,
      enum: ['', 'transient', 'rate_limit', 'authentication', 'permission', 'billing', 'permanent', 'unknown'],
      default: '',
      index: true
    },
    reconnectRequired: {
      type: Boolean,
      default: false,
      index: true
    },
    deadLetteredAt: {
      type: Date,
      default: null,
      index: true
    },
    deadLetterReason: {
      type: String,
      default: ''
    },
    errorCode: {
      type: String,
      default: ''
    },
    errorMessage: {
      type: String,
      default: ''
    },
    errorDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    providerState: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    firstCommentId: {
      type: String,
      default: ''
    },
    warningMessage: {
      type: String,
      default: ''
    },
    platformPostId: {
      type: String,
      default: ''
    },
    platformUrl: {
      type: String,
      default: ''
    },
    publishedAt: {
      type: Date,
      default: null
    },
    metricsStatus: {
      type: String,
      enum: ['pending', 'active', 'limited', 'unsupported', 'error', 'complete'],
      default: 'pending',
      index: true
    },
    metricsLatest: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    metricsAvailableFields: [{ type: String }],
    metricsCapturedAt: {
      type: Date,
      default: null
    },
    nextMetricsSyncAt: {
      type: Date,
      default: null,
      index: true
    },
    metricsSyncLockedUntil: {
      type: Date,
      default: null,
      select: false
    },
    metricsAttempts: {
      type: Number,
      default: 0
    },
    metricsErrorCode: {
      type: String,
      default: ''
    },
    metricsErrorMessage: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

publishJobSchema.index({ projectId: 1, status: 1, scheduledAt: 1 });
publishJobSchema.index({ destinationProjectId: 1, status: 1, publishedAt: -1 });
publishJobSchema.index({ status: 1, nextRetryAt: 1 });
publishJobSchema.index({ status: 1, nextMetricsSyncAt: 1 });
publishJobSchema.index({ draftId: 1, platform: 1, status: 1 });
publishJobSchema.index(
  { batchId: 1, draftId: 1, accountId: 1 },
  { unique: true, name: 'one_job_per_batch_draft_account' }
);

module.exports = mongoose.model('PublishJob', publishJobSchema);
