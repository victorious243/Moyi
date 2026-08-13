const crypto = require('crypto');
const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    // AI-CMO SPEC COMPLIANCE: Subsystems A/B - approved-vs-draft onboarding state,
    // discovered brand profile, draft competitor records, and telemetry trust gate score.
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
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
    industry: {
      type: String,
      trim: true,
      default: ''
    },
    targetAudience: {
      type: String,
      trim: true,
      default: ''
    },
    targetCountry: {
      type: String,
      trim: true,
      default: ''
    },
    mainGoal: {
      type: String,
      trim: true,
      default: ''
    },
    mainOffer: {
      type: String,
      trim: true,
      default: ''
    },
    brandTone: {
      type: String,
      trim: true,
      default: ''
    },
    brandLogo: {
      storageProvider: {
        type: String,
        enum: ['machine', 's3'],
        default: 'machine'
      },
      storageKey: {
        type: String,
        trim: true,
        default: ''
      },
      filename: {
        type: String,
        trim: true,
        default: ''
      },
      mimeType: {
        type: String,
        enum: ['', 'image/png'],
        default: ''
      },
      byteLength: {
        type: Number,
        min: 0,
        default: 0
      },
      uploadedAt: {
        type: Date,
        default: null
      }
    },
    status: {
      type: String,
      enum: ['draft', 'approved'],
      default: 'approved',
      index: true
    },
    brand_profile: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    competitors: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    telemetryHealthScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    telemetryAudit: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    publicProjectKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => crypto.randomBytes(18).toString('hex')
    },
    webhookUrl: {
      type: String,
      trim: true,
      default: ''
    },
    webhookSigningSecret: {
      type: String,
      default: () => crypto.randomBytes(32).toString('hex')
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
