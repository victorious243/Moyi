const mongoose = require('mongoose');

const socialDraftActivitySchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    draftId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialDraft', required: true, index: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    eventType: { type: String, required: true, trim: true, index: true },
    summary: { type: String, required: true, trim: true, maxlength: 500 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

socialDraftActivitySchema.index({ projectId: 1, draftId: 1, createdAt: -1 });
socialDraftActivitySchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('SocialDraftActivity', socialDraftActivitySchema);
