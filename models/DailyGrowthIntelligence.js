const mongoose = require('mongoose');

const dailyGrowthIntelligenceSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    date: {
      type: Date,
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['generated', 'draft', 'archived'],
      default: 'generated'
    },
    reportMode: {
      type: String,
      enum: ['normal', 'opportunity', 'performance_alert', 'milestone'],
      default: 'normal'
    },
    executiveSummary: {
      type: String,
      required: true,
      trim: true
    },
    performanceScore: {
      type: Number,
      default: 75,
      min: 0,
      max: 100
    },
    performanceGrade: {
      type: String,
      enum: ['A+', 'A', 'B', 'C', 'D'],
      default: 'B'
    },
    // Configurable 6-Dimensional Growth Score Breakdown
    growthScoreBreakdown: {
      overallScore: { type: Number, default: 75 },
      scoreDelta: { type: Number, default: 0 },
      movementExplanation: { type: String, default: '' },
      audienceGrowth: { type: Number, default: 70 },
      contentPerformance: { type: Number, default: 75 },
      engagement: { type: Number, default: 70 },
      websiteAcquisition: { type: Number, default: 65 },
      conversion: { type: Number, default: 60 },
      brandVisibility: { type: Number, default: 75 }
    },
    // Key Wins & High-Impact Positives
    keyWins: [{ type: String, trim: true }],
    // Sustained Risks & Problems Requiring Attention
    risksAndProblems: [{
      id: String,
      title: String,
      primarySignal: String,
      impact: String,
      severity: { type: String, enum: ['critical', 'warning', 'advisory'], default: 'warning' },
      recommendation: String
    }],
    // Historical Window Comparisons (Storing Raw Values & Deltas)
    windowComparisons: {
      yesterdayVsPrev: {
        yesterday: { type: mongoose.Schema.Types.Mixed, default: {} },
        previousDay: { type: mongoose.Schema.Types.Mixed, default: {} },
        deltas: { type: mongoose.Schema.Types.Mixed, default: {} }
      },
      last7dVsPrev7d: {
        recent7d: { type: mongoose.Schema.Types.Mixed, default: {} },
        previous7d: { type: mongoose.Schema.Types.Mixed, default: {} },
        deltas: { type: mongoose.Schema.Types.Mixed, default: {} }
      },
      last30dVsPrev30d: {
        recent30d: { type: mongoose.Schema.Types.Mixed, default: {} },
        previous30d: { type: mongoose.Schema.Types.Mixed, default: {} },
        deltas: { type: mongoose.Schema.Types.Mixed, default: {} }
      }
    },
    // Multi-Objective Platform Champions
    platformChampions: {
      bestForReach: {
        platform: String,
        noData: { type: Boolean, default: false },
        value: Number,
        sharePercentage: Number,
        rationale: String
      },
      bestForEngagement: {
        platform: String,
        noData: { type: Boolean, default: false },
        value: Number,
        rate: Number,
        rationale: String
      },
      bestForFollowerGrowth: {
        platform: String,
        noData: { type: Boolean, default: false },
        netGained: Number,
        rationale: String
      },
      bestForWebsiteTraffic: {
        platform: String,
        noData: { type: Boolean, default: false },
        sessions: Number,
        rationale: String
      },
      bestForLeads: {
        platform: String,
        noData: { type: Boolean, default: false },
        leads: Number,
        rationale: String
      },
      bestForConversions: {
        platform: String,
        noData: { type: Boolean, default: false },
        conversions: Number,
        rationale: String
      },
      bestForRevenue: {
        platform: String,
        noData: { type: Boolean, default: false },
        revenue: Number,
        rationale: String
      }
    },
    // Deep Content Intelligence
    contentIntelligence: {
      topPerformingPosts: [{
        postId: String,
        platform: String,
        contentType: String,
        title: String,
        bodyExcerpt: String,
        publishedAt: Date,
        impressions: Number,
        engagements: Number,
        engagementRate: Number,
        websiteClicks: Number,
        whyItWon: String
      }],
      worstPerformingPosts: [{
        postId: String,
        platform: String,
        contentType: String,
        title: String,
        bodyExcerpt: String,
        publishedAt: Date,
        impressions: Number,
        engagements: Number,
        engagementRate: Number,
        frictionPoint: String
      }],
      contentTypeBreakdown: [{
        contentType: String,
        postCount: Number,
        avgImpressions: Number,
        avgEngagements: Number,
        avgEngagementRate: Number,
        avgWebsiteClicks: Number,
        performanceMultiplier: Number
      }],
      detectedPatterns: [{
        patternName: String,
        observation: String,
        evidence: String,
        confidence: { type: String, enum: ['high', 'medium', 'low', 'early_signal'], default: 'medium' },
        sampleSize: Number,
        multiplier: Number,
        recommendation: String
      }],
      optimalTiming: [{
        platform: String,
        bestDay: String,
        bestHourWindow: String,
        performanceMultiplier: Number,
        sampleSize: Number
      }]
    },
    // Daily Diagnoses (Observation -> Evidence -> Root Cause -> Action)
    diagnoses: [{
      id: String,
      observation: String,
      evidence: String,
      likelyExplanation: String,
      confidence: { type: String, enum: ['high', 'medium', 'low', 'early_signal'], default: 'high' },
      businessImpact: { type: String, enum: ['reach', 'traffic', 'conversions', 'brand_equity', 'pipeline'], default: 'traffic' },
      recommendedAction: String,
      priority: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'high' }
    }],
    // Proactive Opportunity Detection
    opportunities: [{
      id: String,
      type: {
        type: String,
        enum: ['viral_breakout', 'high_converting_topic', 'repurposing_arbitrage', 'decay_warning', 'optimal_timing', 'conversion_gap']
      },
      title: String,
      description: String,
      evidence: String,
      actionType: String,
      actionPayload: mongoose.Schema.Types.Mixed,
      priority: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'high' },
      status: { type: String, enum: ['pending', 'accepted', 'dismissed'], default: 'pending' }
    }],
    // Downstream Closed-Loop Attribution
    downstreamAttribution: {
      totalReferralTraffic: { type: Number, default: 0 },
      totalLeads: { type: Number, default: 0 },
      totalConversions: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
      platformBreakdown: [{
        platform: String,
        referralSessions: Number,
        uniqueVisitors: Number,
        leads: Number,
        conversions: Number,
        revenue: Number,
        conversionRate: Number
      }]
    },
    // Prioritized Action List for Today
    todayActionList: [{
      priority: Number,
      action: String,
      platform: String,
      expectedImpact: String,
      rationale: String
    }],
    generatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

dailyGrowthIntelligenceSchema.index({ projectId: 1, date: -1 });

module.exports = mongoose.model('DailyGrowthIntelligence', dailyGrowthIntelligenceSchema);
