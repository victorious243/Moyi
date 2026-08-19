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
      avgDailyImpressions: { type: Number, default: 0 },
      avgDailyEngagements: { type: Number, default: 0 },
      avgDailyReferralSessions: { type: Number, default: 0 },
      avgDailyConversions: { type: Number, default: 0 },
      avgEngagementRate: { type: Number, default: 0 },
      avgPostEngagements: { type: Number, default: 0 }
    },
    // Per-Platform Rolling Baselines
    platformBaselines: [{
      platform: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgDailyImpressions: { type: Number, default: 0 },
      avgDailyEngagements: { type: Number, default: 0 },
      avgEngagementRate: { type: Number, default: 0 },
      avgReferralSessions: { type: Number, default: 0 },
      stdDevEngagementRate: { type: Number, default: 0 }
    }],
    // Per-Content-Format Rolling Baselines (carousel, video, image, text)
    formatBaselines: [{
      format: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgImpressions: { type: Number, default: 0 },
      avgEngagements: { type: Number, default: 0 },
      avgEngagementRate: { type: Number, default: 0 },
      avgClicks: { type: Number, default: 0 },
      multiplierVsBaseline: { type: Number, default: 1.0 }
    }],
    // Per-Topic Rolling Baselines (founder_story, tutorial, product_update, case_study, etc.)
    topicBaselines: [{
      topic: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgImpressions: { type: Number, default: 0 },
      avgEngagements: { type: Number, default: 0 },
      avgEngagementRate: { type: Number, default: 0 },
      multiplierVsBaseline: { type: Number, default: 1.0 }
    }],
    // Per-Timing Rolling Baselines (Platform + Day + Hour Window)
    timingBaselines: [{
      platform: { type: String, required: true },
      dayOfWeek: { type: String, required: true },
      hourWindow: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgEngagements: { type: Number, default: 0 },
      multiplierVsBaseline: { type: Number, default: 1.0 }
    }],
    // Per-CTA Rolling Baselines
    ctaBaselines: [{
      ctaType: { type: String, required: true },
      sampleSize: { type: Number, default: 0 },
      avgClicks: { type: Number, default: 0 },
      avgConversionRate: { type: Number, default: 0 }
    }],
    lastCalculatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProjectGrowthBaseline', projectGrowthBaselineSchema);
