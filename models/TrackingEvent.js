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

module.exports = mongoose.model('TrackingEvent', trackingEventSchema);
