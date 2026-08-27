const mongoose = require('mongoose');

const evidenceRecordSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
  claimKey: { type: String, required: true, trim: true, maxlength: 180, index: true },
  claim: { type: String, required: true, trim: true, maxlength: 1000 },
  classification: {
    type: String,
    enum: ['observed', 'derived', 'modeled', 'hypothesis', 'causal', 'insufficient_evidence'],
    required: true,
    index: true
  },
  causalLevel: {
    type: String,
    enum: ['NONE', 'OBSERVATIONAL', 'STRONG_OBSERVATIONAL', 'EXPERIMENTAL', 'CAUSAL_VALIDATED'],
    default: 'NONE'
  },
  metric: { type: String, default: '', trim: true, index: true },
  source: { type: String, required: true, trim: true, index: true },
  sourceRecordIds: { type: [String], default: [] },
  periodStart: { type: Date, default: null },
  periodEnd: { type: Date, default: null },
  observedAt: { type: Date, default: null, index: true },
  value: { type: Number, default: null },
  previousValue: { type: Number, default: null },
  changePercent: { type: Number, default: null },
  sampleSize: { type: Number, min: 0, default: 0 },
  confidence: { type: Number, min: 0, max: 100, default: 0 },
  dataQualityScore: { type: Number, min: 0, max: 100, default: 0 },
  maturityLevel: { type: Number, min: 0, max: 6, default: 0, index: true },
  businessImpact: { type: String, enum: ['unknown', 'low', 'medium', 'high', 'critical'], default: 'unknown' },
  evidence: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  assumptions: { type: [String], default: [] },
  unknowns: { type: [String], default: [] },
  limitations: { type: [String], default: [] },
  dedupeKey: { type: String, required: true, trim: true },
  expiresAt: { type: Date, default: null, index: true }
}, { timestamps: true });

evidenceRecordSchema.index({ projectId: 1, dedupeKey: 1 }, { unique: true });
evidenceRecordSchema.index({ projectId: 1, classification: 1, metric: 1, observedAt: -1 });
evidenceRecordSchema.index({ organizationId: 1, projectId: 1, createdAt: -1 });

module.exports = mongoose.model('EvidenceRecord', evidenceRecordSchema);
