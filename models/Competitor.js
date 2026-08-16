const mongoose = require('mongoose');

const competitorSchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: true,
      trim: true
    },
    websiteUrl: {
      type: String,
      required: true,
      trim: true
    },
    notes: {
      type: String,
      default: ''
    },
    source: {
      type: String,
      enum: ['manual', 'configured', 'discovered'],
      default: 'manual',
      index: true
    },
    classification: {
      type: String,
      enum: ['direct', 'indirect', 'aspirational'],
      default: 'direct',
      index: true
    },
    businessModel: {
      type: String,
      enum: ['saas', 'ecommerce', 'marketplace', 'agency', 'professional_services', 'local_service', 'retail', 'media', 'nonprofit', 'other'],
      default: 'other'
    },
    locationRelevance: {
      type: String,
      enum: ['local', 'regional', 'national', 'global', 'unknown'],
      default: 'unknown'
    },
    classificationReason: {
      type: String,
      default: ''
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    rationale: {
      type: String,
      default: ''
    },
    discoveryEvidence: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    lastDiscoveredAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

competitorSchema.index({ projectId: 1, userId: 1, websiteUrl: 1 }, { unique: true });

module.exports = mongoose.model('Competitor', competitorSchema);
