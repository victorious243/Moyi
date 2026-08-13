const mongoose = require('mongoose');

const publishJobEventSchema = new mongoose.Schema(
  {
    publishJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PublishJob',
      required: true,
      index: true
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    destinationProjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    eventType: {
      type: String,
      enum: ['created', 'attempt_started', 'retry_scheduled', 'published', 'failed', 'dead_lettered', 'manual_retry', 'metrics_collected', 'metrics_failed', 'reconnect_required'],
      required: true,
      index: true
    },
    fromStatus: { type: String, default: '' },
    toStatus: { type: String, default: '' },
    attempt: { type: Number, default: 0 },
    errorCode: { type: String, default: '' },
    message: { type: String, default: '' },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    }
  },
  { timestamps: true }
);

publishJobEventSchema.index({ publishJobId: 1, createdAt: -1 });
publishJobEventSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.model('PublishJobEvent', publishJobEventSchema);
