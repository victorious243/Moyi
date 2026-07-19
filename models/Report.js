const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    auditId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['ready', 'failed'],
      default: 'ready'
    },
    executiveSummary: { type: String, default: '' },
    currentSeoHealth: { type: String, default: '' },
    mainBusinessRisk: { type: String, default: '' },
    mainGrowthOpportunity: { type: String, default: '' },
    topPriorities: { type: [String], default: [] },
    quickWins: { type: [String], default: [] },
    thirtyDayPlan: { type: [String], default: [] },
    suggestedContentStrategy: { type: String, default: '' },
    pageImprovementPriorities: { type: [String], default: [] },
    internalLinkingStrategy: { type: String, default: '' },
    measurementPlan: { type: String, default: '' },
    warningsLimitations: { type: [String], default: [] },
    sourceIssueIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SeoIssue'
    }],
    sourcePageUrls: {
      type: [String],
      default: []
    },
    model: { type: String, default: '' },
    errorMessage: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Report', reportSchema);
