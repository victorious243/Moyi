const mongoose = require('mongoose');

const growthAlertSchema = new mongoose.Schema(
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
      index: true,
      default: null
    },
    type: {
      type: String,
      enum: [
        'weekly_briefing',
        'competitor_move',
        'keyword_breakthrough',
        'scan_completed',
        'content_approval_nudge',
        'recommendation_urgent'
      ],
      required: true,
      index: true
    },
    severity: {
      type: String,
      enum: ['info', 'growth_opportunity', 'warning', 'critical'],
      default: 'growth_opportunity',
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    summary: {
      type: String,
      required: true,
      trim: true
    },
    evidenceData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    ctaUrl: {
      type: String,
      trim: true,
      default: ''
    },
    ctaLabel: {
      type: String,
      trim: true,
      default: 'View in Moyi'
    },
    channels: {
      type: [String],
      enum: ['email', 'in_app', 'webhook'],
      default: ['email']
    },
    deliveryStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'sent',
      index: true
    },
    recipientEmail: {
      type: String,
      trim: true,
      default: ''
    },
    sentAt: {
      type: Date,
      default: Date.now
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

growthAlertSchema.index({ projectId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('GrowthAlert', growthAlertSchema);
