const mongoose = require('mongoose');

const paidBudgetRecommendationSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    type: {
      type: String,
      enum: ['budget_reallocation', 'scale_winner', 'reduce_waste', 'creative_refresh', 'landing_page_fix'],
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['proposed', 'approved', 'dismissed', 'implemented'],
      default: 'proposed',
      index: true
    },
    title: { type: String, required: true, trim: true },
    evidence: { type: [String], default: [] },
    confidence: { type: Number, min: 0, max: 100, required: true },
    businessImpact: { type: String, required: true, trim: true },
    proposedChange: { type: String, required: true, trim: true },
    risk: { type: String, required: true, trim: true },
    expectedOutcome: { type: String, required: true, trim: true },
    sourceProvider: { type: String, default: '' },
    destinationProvider: { type: String, default: '' },
    proposedShiftPercent: { type: Number, min: 0, max: 100, default: 0 },
    evidenceWindow: {
      start: { type: Date, required: true },
      end: { type: Date, required: true }
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

paidBudgetRecommendationSchema.index({ projectId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('PaidBudgetRecommendation', paidBudgetRecommendationSchema);
