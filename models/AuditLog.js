const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null
    },
    actorEmailSnapshot: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      index: true,
      default: null
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
      index: true
    },
    status: {
      type: String,
      enum: ['success', 'failed', 'pending'],
      default: 'success',
      index: true
    },
    ipAddress: {
      type: String,
      default: ''
    },
    userAgent: {
      type: String,
      default: ''
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
