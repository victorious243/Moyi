const mongoose = require('mongoose');

const cmoReportSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: ['weekly', 'monthly'],
      required: true,
      index: true
    },
    periodStart: {
      type: String,
      required: true,
      index: true
    },
    periodEnd: {
      type: String,
      required: true,
      index: true
    },
    summary: {
      type: String,
      default: ''
    },
    organicSearchPerformance: {
      type: String,
      default: ''
    },
    wins: {
      type: [String],
      default: []
    },
    losses: {
      type: [String],
      default: []
    },
    opportunities: {
      type: [String],
      default: []
    },
    nextActions: {
      type: [String],
      default: []
    },
    nextSevenDaysActionPlan: {
      type: [String],
      default: []
    },
    nextThirtyDaysActionPlan: {
      type: [String],
      default: []
    },
    warningsLimitations: {
      type: [String],
      default: []
    },
    metricsSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    generatedBy: {
      type: String,
      enum: ['ai', 'system'],
      default: 'system'
    },
    aiModel: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

cmoReportSchema.index({ projectId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('CmoReport', cmoReportSchema);
