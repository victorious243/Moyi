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
    recipientUserIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    type: {
      type: String,
      enum: [
        'weekly_briefing',
        'competitor_move',
        'keyword_breakthrough',
        'scan_completed',
        'content_approval_nudge',
        'recommendation_urgent',
        'daily_content_intelligence',
        'daily_growth_intelligence',
        'monthly_strategy_review',
        'tracking_failure',
        'goal_ahead_of_plan',
        'goal_at_risk',
        'goal_achieved',
        'goal_missed',
        'forecast_below_target',
        'forecast_above_target'
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
    category: {
      type: String,
      enum: ['general', 'growth', 'revenue', 'content_approval', 'tracking', 'executive_briefing', 'goals'],
      default: 'growth',
      index: true
    },
    urgency: {
      type: String,
      enum: ['low', 'normal', 'high', 'immediate'],
      default: 'normal'
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100,
      default: 70
    },
    businessImpact: {
      type: String,
      trim: true,
      default: ''
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
    recommendedAction: {
      type: String,
      trim: true,
      default: ''
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
      enum: ['email', 'in_app', 'slack', 'teams', 'discord', 'webhook'],
      default: ['in_app']
    },
    deliveryPolicy: {
      type: String,
      enum: ['immediate', 'digest', 'in_app_only'],
      default: 'immediate'
    },
    recipientRouting: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
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
    },
    readBy: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      readAt: { type: Date, default: Date.now }
    }],
    resolutionStatus: {
      type: String,
      enum: ['open', 'resolved', 'dismissed'],
      default: 'open',
      index: true
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    dedupeKey: {
      type: String,
      trim: true,
      default: ''
    }
  },
  { timestamps: true }
);

growthAlertSchema.index({ projectId: 1, type: 1, createdAt: -1 });
growthAlertSchema.index({ projectId: 1, category: 1, resolutionStatus: 1, createdAt: -1 });
growthAlertSchema.index({ projectId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string', $gt: '' } } });

module.exports = mongoose.model('GrowthAlert', growthAlertSchema);
