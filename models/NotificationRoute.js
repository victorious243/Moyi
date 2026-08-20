const mongoose = require('mongoose');

const notificationRouteSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    category: {
      type: String,
      enum: ['general', 'growth', 'revenue', 'content_approval', 'tracking', 'executive_briefing', 'goals'],
      required: true,
      index: true
    },
    enabled: { type: Boolean, default: true },
    includeOwner: { type: Boolean, default: true },
    memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    externalEmails: [{ type: String, trim: true, lowercase: true }],
    endpointIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'NotificationEndpoint' }],
    channels: [{
      type: String,
      enum: ['in_app', 'email', 'slack', 'teams', 'discord', 'webhook']
    }]
  },
  { timestamps: true }
);

notificationRouteSchema.index({ projectId: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('NotificationRoute', notificationRouteSchema);
