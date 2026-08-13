const mongoose = require('mongoose');

const socialDraftSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true
    },
    sourceContentDraftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentDraft',
      default: null,
      index: true
    },
    contentImageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentImage',
      default: null,
      index: true
    },
    socialAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialAccount',
      default: null,
      index: true
    },
    channel: {
      type: String,
      enum: ['bluesky', 'linkedin', 'facebook', 'x', 'instagram', 'threads', 'youtube', 'tiktok', 'email', 'webhook'],
      required: true,
      index: true
    },
    title: {
      type: String,
      trim: true,
      default: ''
    },
    body: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['draft', 'approved', 'published_manually'],
      default: 'draft',
      index: true
    },
    publishStatus: {
      type: String,
      enum: ['draft', 'pending_approval', 'approved', 'queued', 'publishing', 'published', 'failed'],
      default: 'draft',
      index: true
    },
    publishedAt: {
      type: Date,
      default: null
    },
    platformPostId: {
      type: String,
      default: ''
    },
    errorMessage: {
      type: String,
      default: ''
    },
    scheduledFor: {
      type: Date,
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

socialDraftSchema.index({ projectId: 1, scheduledFor: 1 });

module.exports = mongoose.model('SocialDraft', socialDraftSchema);
