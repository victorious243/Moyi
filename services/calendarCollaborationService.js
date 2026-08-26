const SocialDraftActivity = require('../models/SocialDraftActivity');
const SocialDraftComment = require('../models/SocialDraftComment');
const { recordAuditEvent } = require('./auditLogService');

const REVIEW_ACTIONS = Object.freeze({
  submit: ['draft', 'changes_requested'],
  resubmit: ['changes_requested'],
  approve: ['draft', 'ready_for_review', 'changes_requested'],
  request_changes: ['ready_for_review', 'approved', 'scheduled']
});

function legacyReviewStatus(draft, now = new Date()) {
  if (draft.reviewStatus && draft.reviewStatus !== 'draft') return draft.reviewStatus;
  if (draft.publishStatus === 'pending_approval') return 'ready_for_review';
  if (draft.status === 'approved' || ['approved', 'queued', 'publishing', 'published'].includes(draft.publishStatus)) {
    return draft.scheduledFor && new Date(draft.scheduledFor) > now ? 'scheduled' : 'approved';
  }
  return 'draft';
}

function reviewLabel(status) {
  return {
    draft: 'Draft',
    ready_for_review: 'Ready for Review',
    changes_requested: 'Changes Requested',
    approved: 'Approved',
    scheduled: 'Scheduled'
  }[status] || 'Draft';
}

function assertReviewTransition(draft, action) {
  const current = legacyReviewStatus(draft);
  if (!REVIEW_ACTIONS[action] || !REVIEW_ACTIONS[action].includes(current)) {
    const error = new Error(`${reviewLabel(current)} posts cannot use the ${String(action).replace(/_/g, ' ')} action.`);
    error.statusCode = 422;
    throw error;
  }
  return current;
}

function applyReviewTransition(draft, { action, actorUserId, now = new Date() }) {
  const previous = assertReviewTransition(draft, action);
  if (['submit', 'resubmit'].includes(action)) {
    draft.reviewStatus = 'ready_for_review';
    draft.status = 'draft';
    draft.publishStatus = 'pending_approval';
    draft.submittedBy = actorUserId;
    draft.submittedAt = now;
  } else if (action === 'approve') {
    draft.reviewStatus = draft.scheduledFor && new Date(draft.scheduledFor) > now ? 'scheduled' : 'approved';
    draft.status = 'approved';
    draft.publishStatus = 'approved';
    draft.approvedBy = actorUserId;
    draft.approvedAt = now;
    draft.approvalVersion = Number(draft.approvalVersion || 0) + 1;
    draft.errorMessage = '';
  } else if (action === 'request_changes') {
    draft.reviewStatus = 'changes_requested';
    draft.status = 'draft';
    draft.publishStatus = 'pending_approval';
    draft.changesRequestedBy = actorUserId;
    draft.changesRequestedAt = now;
  }
  return { previous, current: draft.reviewStatus };
}

function safeActivityMetadata(metadata = {}) {
  const allowed = ['from', 'to', 'campaignId', 'assignedTo', 'platform', 'accountId', 'jobId', 'commentId', 'mediaId', 'imageId'];
  return Object.fromEntries(allowed.filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]]));
}

async function recordDraftActivity({ draft, user, eventType, summary, metadata = {}, req = null }) {
  const safeMetadata = safeActivityMetadata(metadata);
  const activity = await SocialDraftActivity.create({
    projectId: draft.projectId,
    draftId: draft._id,
    actorUserId: user?._id || null,
    eventType,
    summary,
    metadata: safeMetadata
  });
  await recordAuditEvent({
    user,
    projectId: draft.projectId,
    eventType: `social_draft_${eventType}`,
    metadata: { draftId: draft._id, ...safeMetadata },
    req
  });
  return activity;
}

async function addDraftComment({ draft, user, body, kind = 'comment', req = null }) {
  const comment = await SocialDraftComment.create({
    projectId: draft.projectId,
    draftId: draft._id,
    authorUserId: user._id,
    body: String(body || '').trim(),
    kind
  });
  await recordDraftActivity({
    draft,
    user,
    eventType: kind === 'change_request' ? 'changes_requested_comment' : 'comment_added',
    summary: kind === 'change_request' ? 'Requested changes with feedback.' : 'Added a comment.',
    metadata: { commentId: comment._id },
    req
  });
  return comment;
}

async function recordDraftCreation(drafts, { user = null, req = null, summary = 'Created the post.' } = {}) {
  const values = (Array.isArray(drafts) ? drafts : [drafts]).filter(Boolean);
  return Promise.allSettled(values.map((draft) => recordDraftActivity({
    draft,
    user,
    eventType: 'created',
    summary,
    req
  })));
}

module.exports = {
  REVIEW_ACTIONS,
  addDraftComment,
  applyReviewTransition,
  assertReviewTransition,
  legacyReviewStatus,
  recordDraftActivity,
  recordDraftCreation,
  reviewLabel,
  safeActivityMetadata
};
