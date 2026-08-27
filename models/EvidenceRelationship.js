const mongoose = require('mongoose');

const evidenceRelationshipSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
  fromType: { type: String, required: true, trim: true, index: true },
  fromId: { type: String, required: true, trim: true },
  relationship: { type: String, required: true, trim: true, index: true },
  toType: { type: String, required: true, trim: true, index: true },
  toId: { type: String, required: true, trim: true },
  evidenceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceRecord' }],
  causalLevel: {
    type: String,
    enum: ['NONE', 'OBSERVATIONAL', 'STRONG_OBSERVATIONAL', 'EXPERIMENTAL', 'CAUSAL_VALIDATED'],
    default: 'NONE'
  },
  confidence: { type: Number, min: 0, max: 100, default: 0 },
  firstObservedAt: { type: Date, default: Date.now },
  lastObservedAt: { type: Date, default: Date.now, index: true },
  active: { type: Boolean, default: true, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
}, { timestamps: true });

evidenceRelationshipSchema.index(
  { projectId: 1, fromType: 1, fromId: 1, relationship: 1, toType: 1, toId: 1 },
  { unique: true }
);

module.exports = mongoose.model('EvidenceRelationship', evidenceRelationshipSchema);
