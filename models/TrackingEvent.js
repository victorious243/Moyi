const mongoose = require('mongoose');

const trackingEventSchema = new mongoose.Schema(
  {
    // AI-CMO SPEC COMPLIANCE: Subsystem C - resolves anonymous sessions to
    // customer/email/Stripe identifiers so revenue can be attributed to touches.
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    publicProjectKey: {
      type: String,
      required: true,
      index: true
    },
    eventType: {
      type: String,
      enum: ['page_view', 'conversion', 'custom'],
      required: true,
      index: true
    },
    eventName: {
      type: String,
      trim: true,
      default: ''
    },
    sessionId: {
      type: String,
      required: true,
      index: true
    },
    visitorId: {
      type: String,
      default: '',
      index: true
    },
    resolvedCustomerId: {
      type: String,
      default: '',
      index: true
    },
    resolvedEmail: {
      type: String,
      lowercase: true,
      trim: true,
      default: '',
      index: true
    },
    stripeCustomerId: {
      type: String,
      default: '',
      index: true
    },
    url: {
      type: String,
      required: true,
      trim: true
    },
    referrer: {
      type: String,
      default: ''
    },
    utmSource: {
      type: String,
      default: ''
    },
    utmMedium: {
      type: String,
      default: ''
    },
    utmCampaign: {
      type: String,
      default: ''
    },
    utmId: {
      type: String,
      default: '',
      index: true
    },
    utmTerm: {
      type: String,
      default: ''
    },
    utmContent: {
      type: String,
      default: '',
      index: true
    },
    experimentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Experiment',
      default: null,
      index: true
    },
    experimentVariant: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    clickIds: {
      gclid: { type: String, default: '' },
      gbraid: { type: String, default: '' },
      wbraid: { type: String, default: '' },
      fbclid: { type: String, default: '' },
      liFatId: { type: String, default: '' },
      ttclid: { type: String, default: '' }
    },
    funnelStage: {
      type: String,
      enum: ['', 'visit', 'lead', 'qualified_lead', 'signup', 'purchase', 'revenue'],
      default: '',
      index: true
    },
    eventValue: {
      type: Number,
      min: 0,
      default: 0
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      default: ''
    },
    deviceType: {
      type: String,
      default: ''
    },
    browser: {
      type: String,
      default: ''
    },
    userAgent: {
      type: String,
      default: ''
    },
    ipHash: {
      type: String,
      default: ''
    },
    country: {
      type: String,
      default: ''
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

trackingEventSchema.index({ projectId: 1, createdAt: -1 });
trackingEventSchema.index({ projectId: 1, eventType: 1, createdAt: -1 });
trackingEventSchema.index({ projectId: 1, resolvedCustomerId: 1, createdAt: 1 });
trackingEventSchema.index({ projectId: 1, stripeCustomerId: 1, createdAt: 1 });
trackingEventSchema.index({ projectId: 1, utmId: 1, funnelStage: 1, createdAt: 1 });
trackingEventSchema.index({ projectId: 1, experimentId: 1, experimentVariant: 1, createdAt: 1 });
trackingEventSchema.index({ projectId: 1, 'clickIds.gclid': 1, createdAt: 1 });
trackingEventSchema.index({ projectId: 1, 'clickIds.fbclid': 1, createdAt: 1 });

module.exports = mongoose.model('TrackingEvent', trackingEventSchema);
