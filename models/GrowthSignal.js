const mongoose = require('mongoose');

const growthSignalSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    sourceProjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    publishJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PublishJob',
      required: true,
      unique: true,
      index: true
    },
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialDraft',
      required: true,
      index: true
    },
    platform: {
      type: String,
      required: true,
      index: true
    },
    signalType: {
      type: String,
      enum: ['social_post_performance'],
      default: 'social_post_performance',
      index: true
    },
    score: {
      type: Number,
      default: 0
    },
    summary: {
      type: String,
      default: '',
      maxlength: 1000
    },
    evidence: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    observedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  { timestamps: true }
);

growthSignalSchema.index({ projectId: 1, observedAt: -1, score: -1 });

module.exports = mongoose.model('GrowthSignal', growthSignalSchema);
