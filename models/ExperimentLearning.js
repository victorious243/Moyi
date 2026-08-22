const mongoose = require('mongoose');

const experimentLearningSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  experimentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Experiment', required: true, unique: true, index: true },
  sourceRecommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recommendation', default: null, index: true },
  experimentType: { type: String, required: true, index: true },
  channel: { type: String, default: '', index: true },
  hypothesis: { type: String, required: true },
  result: { type: String, required: true },
  decision: { type: String, required: true },
  winningVariantKey: { type: String, required: true },
  confidence: { type: Number, min: 0, max: 100, required: true },
  primaryMetric: { type: String, required: true },
  evidence: { type: mongoose.Schema.Types.Mixed, required: true },
  tags: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'superseded', 'retired'], default: 'active', index: true },
  appliedAt: { type: Date, default: Date.now }
}, { timestamps: true });

experimentLearningSchema.index({ projectId: 1, status: 1, appliedAt: -1 });

module.exports = mongoose.model('ExperimentLearning', experimentLearningSchema);
