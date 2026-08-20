const mongoose = require('mongoose');

const notificationEndpointSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    channel: {
      type: String,
      enum: ['slack', 'teams', 'discord', 'webhook'],
      required: true,
      index: true
    },
    encryptedUrl: {
      type: String,
      required: true,
      select: false
    },
    urlHint: {
      type: String,
      required: true,
      trim: true
    },
    encryptedSigningSecret: {
      type: String,
      default: '',
      select: false
    },
    status: {
      type: String,
      enum: ['active', 'disabled', 'error'],
      default: 'active',
      index: true
    },
    failureCount: {
      type: Number,
      min: 0,
      default: 0
    },
    lastAttemptAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastError: { type: String, default: '' }
  },
  { timestamps: true }
);

notificationEndpointSchema.index({ projectId: 1, channel: 1, status: 1 });

module.exports = mongoose.model('NotificationEndpoint', notificationEndpointSchema);
