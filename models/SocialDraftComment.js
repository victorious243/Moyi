const mongoose = require('mongoose');

const socialDraftCommentSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    draftId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialDraft', required: true, index: true },
    authorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    kind: {
      type: String,
      enum: ['comment', 'change_request', 'approval_note'],
      default: 'comment',
      index: true
    },
    editedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

socialDraftCommentSchema.index({ projectId: 1, draftId: 1, createdAt: -1 });
socialDraftCommentSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('SocialDraftComment', socialDraftCommentSchema);
