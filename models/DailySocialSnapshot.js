const mongoose = require('mongoose');

const SUPPORTED_PLATFORMS = [
  'linkedin',
  'facebook',
  'instagram',
  'x',
  'tiktok',
  'youtube',
  'threads',
  'bluesky'
];

const dailySocialSnapshotSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialAccount',
      default: null,
      index: true
    },
    platform: {
      type: String,
      enum: SUPPORTED_PLATFORMS,
      required: true,
      index: true
    },
    date: {
      type: Date,
      required: true,
      index: true
    },
    // Audience Metrics
    followers: { type: Number, default: 0, min: 0 },
    followersGained: { type: Number, default: 0, min: 0 },
    followersLost: { type: Number, default: 0, min: 0 },
    profileVisits: { type: Number, default: 0, min: 0 },

    // Exposure & Reach
    impressions: { type: Number, default: 0, min: 0 },
    reach: { type: Number, default: 0, min: 0 },

    // Engagement Counters
    engagements: { type: Number, default: 0, min: 0 },
    engagementRate: { type: Number, default: 0, min: 0 },
    likes: { type: Number, default: 0, min: 0 },
    comments: { type: Number, default: 0, min: 0 },
    shares: { type: Number, default: 0, min: 0 },
    saves: { type: Number, default: 0, min: 0 },
    reposts: { type: Number, default: 0, min: 0 },
    linkClicks: { type: Number, default: 0, min: 0 },

    // Video Performance
    videoViews: { type: Number, default: 0, min: 0 },
    videoCompletionRate: { type: Number, default: 0, min: 0 },
    watchTimeSeconds: { type: Number, default: 0, min: 0 },

    // Publishing Activity
    postsPublished: { type: Number, default: 0, min: 0 },
    publishJobIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PublishJob'
    }],

    // Downstream Business Impact (Closed-Loop Attribution)
    websiteTraffic: {
      referralSessions: { type: Number, default: 0, min: 0 },
      uniqueVisitors: { type: Number, default: 0, min: 0 },
      leadsGenerated: { type: Number, default: 0, min: 0 },
      conversions: { type: Number, default: 0, min: 0 },
      attributedRevenue: { type: Number, default: 0, min: 0 }
    },

    // Raw provider API response payload (for reproducibility & audits)
    rawProviderData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

dailySocialSnapshotSchema.index({ projectId: 1, platform: 1, date: -1 });
dailySocialSnapshotSchema.index({ projectId: 1, date: -1 });
dailySocialSnapshotSchema.index({ projectId: 1, accountId: 1, date: 1 });

module.exports = mongoose.model('DailySocialSnapshot', dailySocialSnapshotSchema);
module.exports.SUPPORTED_PLATFORMS = SUPPORTED_PLATFORMS;
