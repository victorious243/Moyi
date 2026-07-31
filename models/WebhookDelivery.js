const mongoose = require('mongoose');

const webhookDeliverySchema = new mongoose.Schema(
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
      default: null,
      index: true
    },
    contentDraftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentDraft',
      required: true,
      index: true
    },
    eventType: {
      type: String,
      default: 'content_draft.approved',
      index: true
    },
    targetUrl: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
      index: true
    },
    statusCode: {
      type: Number,
      default: 0
    },
    attempts: {
      type: Number,
      default: 0
    },
    errorMessage: {
      type: String,
      default: ''
    },
    lastAttemptedAt: Date
  },
  { timestamps: true }
);

webhookDeliverySchema.index({ projectId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('WebhookDelivery', webhookDeliverySchema);
