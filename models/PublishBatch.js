const mongoose = require('mongoose');

const publishBatchSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    destinationProjectIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      index: true
    }],
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    draftIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialDraft',
      index: true
    }],
    platforms: [{
      type: String,
      enum: ['bluesky', 'linkedin', 'x', 'facebook', 'instagram', 'threads', 'youtube', 'tiktok', 'email', 'ayrshare', 'buffer', 'webhook']
    }],
    scheduledAt: {
      type: Date,
      default: null,
      index: true
    },
    status: {
      type: String,
      enum: ['queued', 'publishing', 'published', 'partial', 'failed', 'cancelled'],
      default: 'queued',
      index: true
    },
    errorMessage: {
      type: String,
      default: ''
    },
    summary: {
      total: { type: Number, default: 0 },
      successCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
      cancelledCount: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

publishBatchSchema.index({ projectId: 1, createdAt: -1 });
publishBatchSchema.index({ userId: 1, status: 1, scheduledAt: 1 });

module.exports = mongoose.model('PublishBatch', publishBatchSchema);
