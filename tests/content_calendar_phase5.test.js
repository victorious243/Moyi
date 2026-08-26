const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const SocialDraft = require('../models/SocialDraft');
const SocialDraftActivity = require('../models/SocialDraftActivity');
const SocialDraftComment = require('../models/SocialDraftComment');
const CalendarSavedView = require('../models/CalendarSavedView');
const {
  applyReviewTransition,
  assertReviewTransition,
  legacyReviewStatus,
  safeActivityMetadata
} = require('../services/calendarCollaborationService');
const {
  MAX_AGENCY_CALENDAR_ITEMS,
  buildAgencyDraftQuery,
  decorateAgencyCalendarItems,
  filterAgencyCalendarItems,
  groupAgencyCalendarItems,
  normalizeAgencyCalendarFilters,
  sanitizeSavedViewFilters
} = require('../services/agencyCalendarService');
const {
  canChangeProjectRole,
  canEditDraftRole,
  canPublishProjectRole,
  canReviewDraftRole
} = require('../services/projectAccessService');

function id() {
  return new mongoose.Types.ObjectId();
}

function draft(overrides = {}) {
  return {
    _id: id(),
    projectId: id(),
    status: 'draft',
    publishStatus: 'draft',
    reviewStatus: 'draft',
    scheduledFor: new Date('2026-09-10T09:00:00.000Z'),
    ...overrides
  };
}

test('Phase 5 preserves legacy SocialDraft approval states', () => {
  assert.equal(legacyReviewStatus(draft({ publishStatus: 'pending_approval' })), 'ready_for_review');
  assert.equal(legacyReviewStatus(draft({ status: 'approved', publishStatus: 'approved' }), new Date('2026-09-11T00:00:00.000Z')), 'approved');
  assert.equal(legacyReviewStatus(draft({ status: 'approved', publishStatus: 'approved' }), new Date('2026-09-01T00:00:00.000Z')), 'scheduled');
});

test('Phase 5 approval workflow supports submit, change request, resubmit and approval', () => {
  const item = draft();
  const authorId = id();
  const reviewerId = id();

  assert.deepEqual(applyReviewTransition(item, { action: 'submit', actorUserId: authorId }), {
    previous: 'draft',
    current: 'ready_for_review'
  });
  assert.equal(item.publishStatus, 'pending_approval');
  assert.equal(String(item.submittedBy), String(authorId));

  assert.deepEqual(applyReviewTransition(item, { action: 'request_changes', actorUserId: reviewerId }), {
    previous: 'ready_for_review',
    current: 'changes_requested'
  });
  assert.equal(String(item.changesRequestedBy), String(reviewerId));

  applyReviewTransition(item, { action: 'resubmit', actorUserId: authorId });
  applyReviewTransition(item, { action: 'approve', actorUserId: reviewerId, now: new Date('2026-09-01T00:00:00.000Z') });
  assert.equal(item.reviewStatus, 'scheduled');
  assert.equal(item.status, 'approved');
  assert.equal(item.approvalVersion, 1);
});

test('Phase 5 rejects invalid workflow transitions', () => {
  assert.throws(() => assertReviewTransition(draft(), 'resubmit'), /cannot use the resubmit action/);
  assert.throws(() => assertReviewTransition(draft({ reviewStatus: 'approved' }), 'submit'), /cannot use the submit action/);
});

test('Phase 5 role permissions separate editing, review, management and publishing', () => {
  assert.equal(canEditDraftRole('publisher'), true);
  assert.equal(canReviewDraftRole('publisher'), false);
  assert.equal(canPublishProjectRole('publisher'), true);
  assert.equal(canReviewDraftRole('reviewer'), true);
  assert.equal(canPublishProjectRole('reviewer'), false);
  assert.equal(canChangeProjectRole('reviewer'), false);
  assert.equal(canReviewDraftRole('organization_reviewer'), true);
  assert.equal(canPublishProjectRole('organization_reviewer'), false);
  assert.equal(canChangeProjectRole('organization_admin'), true);
});

test('Phase 5 agency query stays inside authorized project IDs and bounded dates', () => {
  const allowedProject = id();
  const foreignProject = id();
  const filters = normalizeAgencyCalendarFilters({
    project: foreignProject,
    from: '2026-08-01',
    to: '2026-12-31',
    platform: 'linkedin',
    approval: 'approved'
  });
  const query = buildAgencyDraftQuery({ projectIds: [allowedProject], filters });

  assert.deepEqual(query.projectId.$in.map(String), [String(allowedProject)]);
  assert.equal(query.channel, 'linkedin');
  assert.equal(query.reviewStatus, undefined);
  assert.equal((query.scheduledFor.$lt - query.scheduledFor.$gte) / 86400000 <= 94, true);
});

test('Phase 5 approval filters run after legacy normalization', () => {
  const projectId = id();
  const oldApproved = draft({ projectId, status: 'approved', publishStatus: 'approved', reviewStatus: undefined, scheduledFor: new Date('2026-01-10T09:00:00.000Z') });
  const pending = draft({ projectId, publishStatus: 'pending_approval', reviewStatus: undefined });
  const projectsById = { [String(projectId)]: { _id: projectId, name: 'Client A' } };
  const items = decorateAgencyCalendarItems({ drafts: [oldApproved, pending], projectsById });

  assert.equal(filterAgencyCalendarItems(items, { status: '', approval: 'approved' }).length, 1);
  assert.equal(filterAgencyCalendarItems(items, { status: '', approval: 'ready_for_review' }).length, 1);
});

test('Phase 5 grouping and saved views retain only normalized calendar fields', () => {
  const projectId = id();
  const item = decorateAgencyCalendarItems({
    drafts: [draft({ projectId })],
    projectsById: { [String(projectId)]: { _id: projectId, name: 'Client A' } }
  })[0];
  const grouped = groupAgencyCalendarItems([item], 'project');
  assert.equal(grouped[String(projectId)].label, 'Client A');

  const saved = sanitizeSavedViewFilters({
    platform: 'x',
    approval: 'not-a-state',
    from: '2026-08-01',
    to: '2026-08-31',
    injected: 'secret'
  });
  assert.equal(saved.platform, 'x');
  assert.equal(saved.approval, undefined);
  assert.equal(saved.injected, undefined);
});

test('Phase 5 agency calendar handles realistic portfolio volumes in bounded pages', () => {
  const projectIds = Array.from({ length: 50 }, () => id());
  const drafts = Array.from({ length: MAX_AGENCY_CALENDAR_ITEMS }, (_, index) => draft({
    projectId: projectIds[index % projectIds.length],
    channel: index % 2 ? 'linkedin' : 'x',
    scheduledFor: new Date(`2026-09-${String((index % 28) + 1).padStart(2, '0')}T09:00:00.000Z`)
  }));
  const projectsById = Object.fromEntries(projectIds.map((projectId, index) => [String(projectId), { _id: projectId, name: `Client ${index + 1}` }]));
  const items = decorateAgencyCalendarItems({ drafts, projectsById });
  const grouped = groupAgencyCalendarItems(items, 'project');

  assert.equal(items.length, 500);
  assert.equal(Object.keys(grouped).length, 50);
  assert.equal(Object.values(grouped).reduce((total, group) => total + group.items.length, 0), 500);
  assert.equal(normalizeAgencyCalendarFilters({ page: '999999' }).page, 1000);
});

test('Phase 5 activity metadata rejects token-like and arbitrary values', () => {
  assert.deepEqual(safeActivityMetadata({
    from: 'draft',
    to: 'approved',
    accessToken: 'must-not-be-stored',
    body: 'full private content',
    accountId: 'account-1'
  }), { from: 'draft', to: 'approved', accountId: 'account-1' });
});

test('Phase 5 collaboration schemas include tenant indexes', () => {
  const draftIndexes = SocialDraft.schema.indexes().map(([fields]) => fields);
  const activityIndexes = SocialDraftActivity.schema.indexes().map(([fields]) => fields);
  const commentIndexes = SocialDraftComment.schema.indexes().map(([fields]) => fields);
  const savedViewIndexes = CalendarSavedView.schema.indexes().map(([fields]) => fields);

  assert.ok(draftIndexes.some((fields) => fields.projectId === 1 && fields.reviewStatus === 1 && fields.scheduledFor === 1));
  assert.ok(activityIndexes.some((fields) => fields.projectId === 1 && fields.draftId === 1));
  assert.ok(commentIndexes.some((fields) => fields.projectId === 1 && fields.draftId === 1));
  assert.ok(savedViewIndexes.some((fields) => fields.organizationId === 1 && fields.userId === 1));
});

test('Phase 5 routes scope draft, comment, activity and account reads to authorized tenants', () => {
  const socialRoutes = fs.readFileSync(path.join(__dirname, '../routes/socialDrafts.js'), 'utf8');
  const agencyRoutes = fs.readFileSync(path.join(__dirname, '../routes/organizations.js'), 'utf8');

  assert.match(socialRoutes, /SocialDraftComment\.find\(\{ draftId: req\.socialDraft\._id, projectId: req\.project\._id \}\)/);
  assert.match(socialRoutes, /SocialDraftActivity\.find\(\{ draftId: req\.socialDraft\._id, projectId: req\.project\._id \}\)/);
  assert.match(socialRoutes, /socialAccountAccessFilter\(req\.user\._id\)/);
  assert.match(agencyRoutes, /projectId: \{ \$in: projectIds \}/);
  assert.match(agencyRoutes, /organizationId: req\.organization\._id, userId: req\.user\._id/);
  assert.match(agencyRoutes, /Post is unavailable in this agency workspace/);
  assert.match(agencyRoutes, /active publishing job and cannot be changed/);
  assert.match(agencyRoutes, /wantsJson\(req\)/);
});
