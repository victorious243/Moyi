const mongoose = require('mongoose');

const notificationDeliverySchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    alertId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GrowthAlert',
      default: null,
      index: true
    },
    endpointId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NotificationEndpoint',
      default: null,
      index: true
    },
    channel: {
      type: String,
      enum: ['email', 'in_app', 'slack', 'teams', 'discord', 'webhook'],
      required: true,
      index: true
    },
    recipient: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'skipped'],
      default: 'pending',
      index: true
    },
    attempts: { type: Number, min: 0, default: 0 },
    statusCode: { type: Number, default: 0 },
    errorMessage: { type: String, default: '' },
    nextRetryAt: { type: Date, default: null, index: true },
    lastAttemptAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    dedupeKey: { type: String, trim: true, default: '' }
  },
  { timestamps: true }
);

notificationDeliverySchema.index({ projectId: 1, status: 1, createdAt: -1 });
notificationDeliverySchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string', $gt: '' } } });

module.exports = mongoose.model('NotificationDelivery', notificationDeliverySchema);
