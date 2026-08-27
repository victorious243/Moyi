const mongoose = require('mongoose');

const strategicOpportunitySchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  type: {
    type: String,
    enum: ['market', 'channel', 'search', 'content', 'cro', 'competitor_weakness', 'audience', 'geography', 'partnership', 'paid_media'],
    required: true,
    index: true
  },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  opportunity: { type: String, required: true },
  evidence: { type: mongoose.Schema.Types.Mixed, required: true },
  evidenceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceRecord' }],
  evidenceClassification: { type: String, enum: ['observed', 'derived', 'modeled', 'hypothesis', 'causal', 'insufficient_evidence'], default: 'observed' },
  evidenceSummary: { type: String, required: true },
  confidence: { type: Number, min: 0, max: 100, required: true },
  potentialImpact: { type: String, enum: ['low', 'medium', 'high', 'transformational'], required: true },
  difficulty: { type: String, enum: ['low', 'medium', 'high'], required: true },
  strategicPriority: { type: Number, min: 0, max: 100, default: 0, index: true },
  urgencyScore: { type: Number, min: 0, max: 100, default: 50 },
  risk: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  recommendedAction: { type: String, required: true },
  channel: { type: String, default: '' },
  timeSensitivity: { type: String, enum: ['low', 'normal', 'high', 'immediate'], default: 'normal' },
  status: { type: String, enum: ['open', 'accepted', 'dismissed', 'in_progress', 'completed', 'expired'], default: 'open', index: true },
  dedupeKey: { type: String, required: true, trim: true },
  firstDetectedAt: { type: Date, default: Date.now },
  lastDetectedAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, default: null },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acceptedAt: { type: Date, default: null },
  sourceRefs: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
}, { timestamps: true });

strategicOpportunitySchema.index({ projectId: 1, dedupeKey: 1 }, { unique: true });
strategicOpportunitySchema.index({ projectId: 1, status: 1, confidence: -1, lastDetectedAt: -1 });

module.exports = mongoose.model('StrategicOpportunity', strategicOpportunitySchema);
