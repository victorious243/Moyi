const mongoose = require('mongoose');

const competitorSnapshotSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  competitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Competitor', required: true, index: true },
  capturedAt: { type: Date, default: Date.now, index: true },
  fingerprint: { type: String, required: true },
  pages: [{
    url: { type: String, required: true },
    title: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
    h1: { type: [String], default: [] },
    headings: { type: [String], default: [] },
    wordCount: { type: Number, default: 0 },
    fingerprint: { type: String, required: true },
    signals: {
      pricing: { type: Boolean, default: false },
      offer: { type: Boolean, default: false },
      campaign: { type: Boolean, default: false }
    }
  }],
  summary: {
    pageCount: { type: Number, default: 0 },
    contentVelocity30d: { type: Number, default: 0 },
    pricingPageCount: { type: Number, default: 0 },
    offerPageCount: { type: Number, default: 0 },
    campaignPageCount: { type: Number, default: 0 },
    positioningTerms: { type: [String], default: [] }
  },
  changes: [{
    type: { type: String, enum: ['new_page', 'removed_page', 'messaging_change', 'pricing_change', 'offer_change', 'new_campaign', 'positioning_change'] },
    url: { type: String, default: '' },
    summary: { type: String, required: true },
    before: { type: String, default: '' },
    after: { type: String, default: '' },
    confidence: { type: Number, min: 0, max: 100, default: 0 }
  }],
  source: { type: String, enum: ['public_crawl'], default: 'public_crawl' },
  limitations: { type: [String], default: [] }
}, { timestamps: true });

competitorSnapshotSchema.index({ projectId: 1, competitorId: 1, capturedAt: -1 });

module.exports = mongoose.model('CompetitorSnapshot', competitorSnapshotSchema);
