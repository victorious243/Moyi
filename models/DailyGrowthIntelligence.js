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
      enum: ['normal', 'opportunity', 'performance_alert', 'milestone', 'insufficient_data'],
      default: 'normal'
    },
    schemaVersion: { type: Number, default: 2 },
    dataQuality: {
      status: { type: String, enum: ['setup', 'collecting', 'provisional', 'reliable', 'insufficient'], default: 'collecting' },
      coverage: { type: Number, default: 0 },
      freshness: { type: Number, default: 0 },
      confidence: { type: Number, default: 0 },
      confidenceLabel: { type: String, enum: ['high', 'medium', 'low', 'insufficient'], default: 'insufficient' },
      verifiedMetrics: { type: Number, default: 0 },
      expectedMetrics: { type: Number, default: 0 },
      eligiblePlatforms: { type: Number, default: 0 },
      verifiedPlatforms: { type: Number, default: 0 },
      verifiedPlatformNames: [{ type: String }],
      issues: [{
        platform: String,
        type: String,
        message: String,
        syncRunId: String,
        observedAt: Date
      }],
      health: [{
        source: String,
        label: String,
        status: String,
        message: String,
        lastSyncedAt: Date,
        syncRunId: String,
        metricsVerified: Number,
        metricsExpected: Number,
        configured: Boolean
      }],
      revenueConfigured: { type: Boolean, default: false },
      hasHistoricalBaseline: { type: Boolean, default: false },
      baselineDays: { type: Number, default: 0 }
    },
    executiveSummary: {
      type: String,
      required: true,
      trim: true
    },
    performanceScore: {
      type: Number,
      default: null,
      min: 0,
      max: 100
    },
    performanceGrade: {
      type: String,
      enum: ['A+', 'A', 'B', 'C', 'D', 'N/A'],
      default: 'N/A'
    },
    // Configurable 6-Dimensional Growth Score Breakdown
    growthScoreBreakdown: {
      overallScore: { type: Number, default: null },
      scoreDelta: { type: Number, default: null },
      movementExplanation: { type: String, default: '' },
      audienceGrowth: { type: Number, default: null },
      contentPerformance: { type: Number, default: null },
      engagement: { type: Number, default: null },
      websiteAcquisition: { type: Number, default: null },
      conversion: { type: Number, default: null },
      brandVisibility: { type: Number, default: null },
      status: { type: String, enum: ['scored', 'insufficient_data', 'building_baseline'], default: 'insufficient_data' },
      dataConfidence: { type: Number, default: 0 },
      baselineStatus: { type: String, default: '' },
      dataQuality: {
        hasVerifiedData: { type: Boolean, default: false },
        reason: { type: String, default: '' },
        observedMetrics: [{ type: String }]
      }
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
        current: { type: mongoose.Schema.Types.Mixed, default: {} },
        previous: { type: mongoose.Schema.Types.Mixed, default: {} },
        deltas: { type: mongoose.Schema.Types.Mixed, default: {} }
      },
      last7dVsPrev7d: {
        current: { type: mongoose.Schema.Types.Mixed, default: {} },
        previous: { type: mongoose.Schema.Types.Mixed, default: {} },
        deltas: { type: mongoose.Schema.Types.Mixed, default: {} }
      },
      last30dVsPrev30d: {
        current: { type: mongoose.Schema.Types.Mixed, default: {} },
        previous: { type: mongoose.Schema.Types.Mixed, default: {} },
        deltas: { type: mongoose.Schema.Types.Mixed, default: {} }
      },
      scoringBaseline: { type: mongoose.Schema.Types.Mixed, default: {} }
    },
    // Multi-Objective Platform Champions
    platformChampions: {
      bestForReach: {
        platform: String,
        noData: { type: Boolean, default: false },
        value: Number,
        sharePercentage: Number,
        coverage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        rationale: String
      },
      bestForEngagement: {
        platform: String,
        noData: { type: Boolean, default: false },
        value: Number,
        rate: Number,
        coverage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        rationale: String
      },
      bestForFollowerGrowth: {
        platform: String,
        noData: { type: Boolean, default: false },
        netGained: Number,
        coverage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        rationale: String
      },
      bestForWebsiteTraffic: {
        platform: String,
        noData: { type: Boolean, default: false },
        sessions: Number,
        coverage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        rationale: String
      },
      bestForLeads: {
        platform: String,
        noData: { type: Boolean, default: false },
        leads: Number,
        coverage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        rationale: String
      },
      bestForConversions: {
        platform: String,
        noData: { type: Boolean, default: false },
        conversions: Number,
        coverage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        rationale: String
      },
      bestForRevenue: {
        platform: String,
        noData: { type: Boolean, default: false },
        revenue: Number,
        coverage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
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
        signalStatus: { type: String, enum: ['proven_pattern', 'emerging_signal'], default: 'emerging_signal' },
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
      evidenceIds: [{ type: String }],
      evidenceObjects: [{ type: mongoose.Schema.Types.Mixed }],
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
      evidenceIds: [{ type: String }],
      confidence: { type: Number, default: 0 },
      hypothesis: String,
      expectedOutcome: String,
      measurement: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
      actionType: String,
      actionPayload: mongoose.Schema.Types.Mixed,
      priority: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'high' },
      status: { type: String, enum: ['pending', 'accepted', 'dismissed'], default: 'pending' }
    }],
    // Downstream Closed-Loop Attribution
    downstreamAttribution: {
      measurementStatus: { type: String, enum: ['verified', 'pending', 'not_connected', 'unsupported', 'provider_error'], default: 'pending' },
      revenueStatus: { type: String, enum: ['verified', 'pending', 'not_configured', 'provider_error'], default: 'not_configured' },
      totalReferralTraffic: { type: Number, default: null },
      totalLeads: { type: Number, default: null },
      totalConversions: { type: Number, default: null },
      totalRevenue: { type: Number, default: null },
      platformBreakdown: [{
        platform: String,
        status: String,
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
