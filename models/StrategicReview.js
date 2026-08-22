const mongoose = require('mongoose');

const strategicReviewSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  executiveSummary: { type: String, required: true },
  sections: {
    whatChanged: { type: [String], default: [] },
    performanceVsGoals: { type: [String], default: [] },
    revenuePipeline: { type: [String], default: [] },
    winningChannels: { type: [String], default: [] },
    underperformingChannels: { type: [String], default: [] },
    competitiveMovement: { type: [String], default: [] },
    audienceChanges: { type: [String], default: [] },
    searchDemand: { type: [String], default: [] },
    campaignResults: { type: [String], default: [] },
    majorRisks: { type: [String], default: [] },
    majorOpportunities: { type: [String], default: [] },
    whatToStop: { type: [String], default: [] },
    whatToContinue: { type: [String], default: [] },
    whatToIncrease: { type: [String], default: [] },
    whatToTest: { type: [String], default: [] },
    nextMonthPriorities: { type: [String], default: [] }
  },
  evidence: { type: mongoose.Schema.Types.Mixed, required: true },
  limitations: { type: [String], default: [] },
  generatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

strategicReviewSchema.index({ projectId: 1, periodStart: 1, periodEnd: 1 }, { unique: true });

module.exports = mongoose.model('StrategicReview', strategicReviewSchema);
