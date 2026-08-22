const mongoose = require('mongoose');

const paidAttributionSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    trackingEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TrackingEvent',
      required: true,
      unique: true,
      index: true
    },
    sessionId: { type: String, required: true, index: true },
    provider: {
      type: String,
      enum: ['google_ads', 'meta_ads', 'linkedin_ads', 'tiktok_ads', 'unknown_paid'],
      required: true,
      index: true
    },
    campaignExternalId: { type: String, default: '', index: true },
    adGroupExternalId: { type: String, default: '', index: true },
    creativeExternalId: { type: String, default: '', index: true },
    clickIdType: { type: String, enum: ['', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'li_fat_id', 'ttclid'], default: '' },
    clickIdHash: { type: String, default: '', index: true },
    funnelStage: {
      type: String,
      enum: ['visit', 'lead', 'qualified_lead', 'signup', 'purchase', 'revenue'],
      required: true,
      index: true
    },
    value: { type: Number, min: 0, default: 0 },
    currency: { type: String, uppercase: true, default: '' },
    confidence: {
      score: { type: Number, min: 0, max: 100, required: true },
      band: { type: String, enum: ['low', 'medium', 'high'], required: true },
      reason: { type: String, required: true }
    },
    attributedAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

paidAttributionSchema.index({ projectId: 1, provider: 1, attributedAt: -1 });
paidAttributionSchema.index({ projectId: 1, campaignExternalId: 1, funnelStage: 1 });

module.exports = mongoose.model('PaidAttribution', paidAttributionSchema);

