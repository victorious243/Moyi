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
    targetCity: {
      type: String,
      trim: true,
      default: ''
    },
    businessModel: {
      type: String,
      enum: ['', 'saas', 'ecommerce', 'marketplace', 'agency', 'professional_services', 'local_service', 'retail', 'media', 'nonprofit', 'other'],
      default: '',
      index: true
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
    strategicContext: {
      companyStage: { type: String, enum: ['', 'pre_launch', 'early', 'growth', 'scale', 'mature'], default: '' },
      primaryMarket: { type: String, trim: true, default: '' },
      products: { type: [String], default: [] },
      pricingSummary: { type: String, trim: true, default: '' },
      grossMarginPercent: { type: Number, min: 0, max: 100, default: null },
      averageOrderValue: { type: Number, min: 0, default: null },
      revenueTarget: { type: Number, min: 0, default: null },
      acquisitionTarget: { type: Number, min: 0, default: null },
      cacTarget: { type: Number, min: 0, default: null },
      roasTarget: { type: Number, min: 0, default: null },
      conversionTarget: { type: Number, min: 0, default: null },
      salesCycleDays: { type: Number, min: 0, default: null },
      monthlyMarketingBudget: { type: Number, min: 0, default: null },
      availableChannels: { type: [String], default: [] },
      strategicPriorities: { type: [String], default: [] },
      constraints: { type: [String], default: [] },
      seasonalityNotes: { type: String, trim: true, default: '' },
      riskTolerance: { type: String, enum: ['', 'low', 'medium', 'high'], default: '' },
      updatedAt: { type: Date, default: null }
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
    competitorDiscovery: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
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
    },
    timezone: {
      type: String,
      trim: true,
      default: 'UTC'
    },
    cmoNotifications: {
      dailyGrowthIntelligence: {
        enabled: {
          type: Boolean,
          default: true
        },
        reportingHour: {
          type: Number,
          default: 7,
          min: 0,
          max: 23
        },
        deliveryTime: {
          type: String,
          default: '07:00'
        },
        lastGeneratedAt: {
          type: Date,
          default: null
        }
      },
      dailyContentIntelligence: {
        enabled: {
          type: Boolean,
          default: false
        },
        deliveryTime: {
          type: String,
          default: '09:00'
        },
        lastGeneratedAt: {
          type: Date,
          default: null
        }
      },
      weeklyBriefing: {
        enabled: {
          type: Boolean,
          default: true
        },
        deliveryDay: {
          type: String,
          enum: ['monday', 'friday', 'sunday'],
          default: 'monday'
        },
        deliveryTime: {
          type: String,
          default: '08:00'
        },
        lastSentAt: {
          type: Date,
          default: null
        },
        recipientEmails: {
          type: [String],
          default: []
        }
      },
      monthlyStrategyReview: {
        enabled: {
          type: Boolean,
          default: false
        },
        deliveryDate: {
          type: Number,
          min: 1,
          max: 28,
          default: 1
        },
        deliveryTime: {
          type: String,
          default: '08:00'
        },
        lastSentAt: {
          type: Date,
          default: null
        }
      },
      growthAlerts: {
        enabled: {
          type: Boolean,
          default: true
        },
        lastSentAt: {
          type: Date,
          default: null
        },
        minSeverity: {
          type: String,
          enum: ['all', 'important', 'high', 'critical'],
          default: 'high'
        }
      },
      channels: {
        inApp: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        slack: { type: Boolean, default: false },
        teams: { type: Boolean, default: false },
        discord: { type: Boolean, default: false },
        webhook: { type: Boolean, default: false }
      },
      contentApprovalNudges: {
        enabled: {
          type: Boolean,
          default: true
        },
        lastSentAt: {
          type: Date,
          default: null
        }
      }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
