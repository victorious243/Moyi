const mongoose = require('mongoose');

const projectJobSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['ai_report', 'measurement_report', 'search_console_sync', 'content_pipeline', 'content_image_generation'],
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'queued',
      index: true
    },
    fingerprint: {
      type: String,
      default: '',
      index: true
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    queueJobId: {
      type: String,
      default: ''
    },
    attemptsMade: {
      type: Number,
      default: 0
    },
    currentStep: {
      type: String,
      default: ''
    },
    progressPercent: {
      type: Number,
      default: 0
    },
    errorMessage: {
      type: String,
      default: ''
    },
    startedAt: Date,
    completedAt: Date
  },
  { timestamps: true }
);

projectJobSchema.index({ projectId: 1, type: 1, createdAt: -1 });
projectJobSchema.index({ projectId: 1, userId: 1, fingerprint: 1, status: 1 });

module.exports = mongoose.model('ProjectJob', projectJobSchema);
