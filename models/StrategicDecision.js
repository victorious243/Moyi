const mongoose = require('mongoose');

const strategicDecisionSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  opportunityId: { type: mongoose.Schema.Types.ObjectId, ref: 'StrategicOpportunity', default: null, index: true },
  recommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recommendation', default: null, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  recommendation: { type: String, required: true },
  evidenceAtDecision: { type: mongoose.Schema.Types.Mixed, required: true },
  confidenceAtDecision: { type: Number, min: 0, max: 100, required: true },
  decision: { type: String, enum: ['pending', 'accepted', 'rejected', 'deferred'], default: 'pending', index: true },
  executionStatus: { type: String, enum: ['not_started', 'in_progress', 'completed', 'cancelled'], default: 'not_started', index: true },
  decisionReason: { type: String, default: '' },
  decidedAt: { type: Date, default: null },
  executedAt: { type: Date, default: null },
  measurementDueAt: { type: Date, default: null },
  measuredAt: { type: Date, default: null },
  outcome: {
    metric: { type: String, default: '' },
    beforeValue: { type: Number, default: null },
    afterValue: { type: Number, default: null },
    changePercent: { type: Number, default: null },
    summary: { type: String, default: '' },
    confidence: { type: Number, min: 0, max: 100, default: null }
  }
}, { timestamps: true });

strategicDecisionSchema.index({ projectId: 1, decision: 1, executionStatus: 1, createdAt: -1 });

module.exports = mongoose.model('StrategicDecision', strategicDecisionSchema);
