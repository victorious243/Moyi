const mongoose = require('mongoose');

const projectGrowthBaselineSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      unique: true,
      index: true
    },
    calculatedWindowDays: {
      type: Number,
      default: 60
    },
    totalPostsAnalyzed: {
      type: Number,
      default: 0
    },
    // Overall Project-Level Rolling Baselines
    overall: {
      avgDailyImpressions: { type: Number, default: null },
      avgDailyEngagements: { type: Number, default: null },
      avgDailyReferralSessions: { type: Number, default: null },
      avgDailyConversions: { type: Number, default: null },
      avgEngagementRate: { type: Number, default: null },
      avgPostEngagements: { type: Number, default: null }
    },
    measurementStatus: { type: String, enum: ['ready', 'building', 'insufficient_data'], default: 'insufficient_data' },
    verifiedBaselineDays: { type: Number, default: 0 },
    // Per-Platform Rolling Baselines
    platformBaselines: [{
      platform: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgDailyImpressions: { type: Number, default: null },
      avgDailyEngagements: { type: Number, default: null },
      avgEngagementRate: { type: Number, default: null },
      avgReferralSessions: { type: Number, default: null },
      stdDevEngagementRate: { type: Number, default: null }
    }],
    // Per-Content-Format Rolling Baselines (carousel, video, image, text)
    formatBaselines: [{
      format: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgImpressions: { type: Number, default: null },
      avgEngagements: { type: Number, default: null },
      avgEngagementRate: { type: Number, default: null },
      avgClicks: { type: Number, default: null },
      multiplierVsBaseline: { type: Number, default: null }
    }],
    // Per-Topic Rolling Baselines (founder_story, tutorial, product_update, case_study, etc.)
    topicBaselines: [{
      topic: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgImpressions: { type: Number, default: null },
      avgEngagements: { type: Number, default: null },
      avgEngagementRate: { type: Number, default: null },
      multiplierVsBaseline: { type: Number, default: null }
    }],
    // Per-Timing Rolling Baselines (Platform + Day + Hour Window)
    timingBaselines: [{
      platform: { type: String, required: true },
      dayOfWeek: { type: String, required: true },
      hourWindow: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgEngagements: { type: Number, default: null },
      multiplierVsBaseline: { type: Number, default: null }
    }],
    // Per-CTA Rolling Baselines
    ctaBaselines: [{
      ctaType: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgClicks: { type: Number, default: null },
      avgConversionRate: { type: Number, default: null }
    }],
    experimentLearnings: [{
      experimentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Experiment', required: true },
      experimentType: { type: String, required: true },
      channel: { type: String, default: '' },
      primaryMetric: { type: String, required: true },
      result: { type: String, required: true },
      decision: { type: String, required: true },
      confidence: { type: Number, min: 0, max: 100, required: true },
      appliedAt: { type: Date, required: true }
    }],
    lastCalculatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProjectGrowthBaseline', projectGrowthBaselineSchema);
