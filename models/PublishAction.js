const mongoose = require('mongoose');

const publishActionSchema = new mongoose.Schema(
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
    contentDraftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentDraft',
      default: null,
      index: true
    },
    socialDraftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialDraft',
      default: null,
      index: true
    },
    socialAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialAccount',
      default: null,
      index: true
    },
    integrationType: {
      type: String,
      enum: ['wordpress', 'webflow', 'shopify', 'linkedin', 'x', 'facebook', 'instagram', 'youtube', 'tiktok', 'ayrshare', 'buffer', 'webhook', 'manual'],
      default: 'wordpress'
    },
    actionType: {
      type: String,
      enum: ['create_post', 'update_page', 'publish_social_post', 'export_only', 'webhook_dispatch', 'manual_record'],
      required: true
    },
    externalId: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
      index: true
    },
    errorMessage: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

publishActionSchema.index({ projectId: 1, userId: 1, contentDraftId: 1, createdAt: -1 });

module.exports = mongoose.model('PublishAction', publishActionSchema);
