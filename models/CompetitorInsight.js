const mongoose = require('mongoose');

const competitorInsightSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    competitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Competitor',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      required: true,
      trim: true
    },
    insight: {
      type: String,
      required: true
    },
    opportunity: {
      type: String,
      required: true
    },
    evidenceSummary: {
      type: String,
      default: ''
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    generatedBy: {
      type: String,
      enum: ['system', 'ai'],
      default: 'system'
    },
    priority: {
      type: Number,
      min: 1,
      max: 5,
      default: 3
    }
  },
  { timestamps: true }
);

competitorInsightSchema.index({ projectId: 1, competitorId: 1, createdAt: -1 });

module.exports = mongoose.model('CompetitorInsight', competitorInsightSchema);
