const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const Organization = require('../models/Organization');
const OrganizationMember = require('../models/OrganizationMember');
const Project = require('../models/Project');
const User = require('../models/User');
const Campaign = require('../models/Campaign');
const CalendarSavedView = require('../models/CalendarSavedView');
const ContentImage = require('../models/ContentImage');
const MediaAsset = require('../models/MediaAsset');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');
const SocialDraft = require('../models/SocialDraft');
const SocialDraftActivity = require('../models/SocialDraftActivity');
const { requireAuth } = require('../middleware/auth');
const { recordAuditEvent } = require('../services/auditLogService');
const {
  buildAgencyWorkspaceDashboard,
  canManageOrganizationRole,
  createOrganization,
  listAccessibleOrganizations,
  organizationRole
} = require('../services/organizationService');
const { sendTeamInviteEmail } = require('../services/emailService');
const {
  buildAgencyDraftQuery,
  decorateAgencyCalendarItems,
  filterAgencyCalendarItems,
  groupAgencyCalendarItems,
  normalizeAgencyCalendarFilters,
  sanitizeSavedViewFilters,
  MAX_AGENCY_CALENDAR_ITEMS
} = require('../services/agencyCalendarService');
const { applyReviewTransition, recordDraftActivity } = require('../services/calendarCollaborationService');
const { latestJobsByDraft, validateCalendarReschedule } = require('../services/contentCalendarService');
const { createAndQueuePublishBatch } = require('../services/contentDistributionEngineService');
const {
  canChangeProjectRole,
  canPublishProjectRole,
  canReviewDraftRole,
  publishableProjectIds
} = require('../services/projectAccessService');
const { socialAccountAccessFilter } = require('../services/socialAccountService');
const { buildPublishReadiness } = require('../services/socialPublisherService');
const env = require('../config/env');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

async function loadOrganization(req, res, next) {
  try {
    const organization = await Organization.findOne({ _id: req.params.id, status: 'active' });
    if (!organization) return next(new AppError('Agency workspace not found.', 404));
    const role = await organizationRole({ organizationId: organization._id, userId: req.user._id });
    if (!role) return next(new AppError('Agency workspace not found.', 404));
    req.organization = organization;
    req.organizationRole = role;
    res.locals.organization = organization;
    res.locals.organizationRole = role;
    res.locals.canManageOrganization = canManageOrganizationRole(role);
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireOrganizationManager(req, res, next) {
  if (!canManageOrganizationRole(req.organizationRole)) {
    return next(new AppError('You do not have permission to manage this agency workspace.', 403));
  }
  return next();
}

function wantsJson(req) {
  return String(req.get('accept') || '').includes('application/json');
}

router.get('/', asyncHandler(async (req, res) => {
  const organizations = await listAccessibleOrganizations(req.user._id);
  const organizationIds = organizations.map((organization) => organization._id);
  const [projects, members] = await Promise.all([
    Project.find({ organizationId: { $in: organizationIds } }).select('name websiteUrl organizationId').sort({ name: 1 }).lean(),
    OrganizationMember.find({ organizationId: { $in: organizationIds } }).select('organizationId').lean()
  ]);
  const counts = organizations.reduce((map, organization) => {
    map[String(organization._id)] = {
      projects: projects.filter((project) => String(project.organizationId) === String(organization._id)).length,
      members: members.filter((member) => String(member.organizationId) === String(organization._id)).length
    };
    return map;
  }, {});
  res.render('organizations/index', {
    title: 'Agency workspaces',
    organizations,
    counts,
    message: req.query.message || '',
    errorMessage: req.query.error || ''
  });
}));

router.post('/', [
  body('name').trim().notEmpty().isLength({ max: 160 }).withMessage('Agency workspace name is required.'),
  handleValidation
], asyncHandler(async (req, res) => {
  const organization = await createOrganization({ ownerId: req.user._id, name: req.body.name });
  await recordAuditEvent({
    user: req.user,
    eventType: 'organization_created',
    metadata: { organizationId: organization._id, organizationName: organization.name },
    req
  });
  res.redirect(`/organizations/${organization._id}?message=${encodeURIComponent('Agency workspace created.')}`);
}));

router.get('/:id/calendar', [param('id').isMongoId(), handleValidation], loadOrganization, asyncHandler(async (req, res) => {
  const projects = await Project.find({ organizationId: req.organization._id }).select('name websiteUrl brandLogo timezone owner').sort({ name: 1 }).lean();
  const projectIds = projects.map((project) => project._id);
  const filters = normalizeAgencyCalendarFilters(req.query);
  const draftQuery = buildAgencyDraftQuery({ projectIds, filters });
  const draftRows = projectIds.length
    ? await SocialDraft.find(draftQuery)
      .select('projectId campaignId socialAccountId channel title body status publishStatus reviewStatus assignedTo scheduledFor publishedAt errorMessage metadata')
      .sort({ scheduledFor: 1 })
      .skip((filters.page - 1) * MAX_AGENCY_CALENDAR_ITEMS)
      .limit(MAX_AGENCY_CALENDAR_ITEMS + 1)
      .populate('campaignId', 'name channel')
      .populate('assignedTo', 'name email')
      .lean()
    : [];
  const hasNextPage = draftRows.length > MAX_AGENCY_CALENDAR_ITEMS;
  const drafts = draftRows.slice(0, MAX_AGENCY_CALENDAR_ITEMS);
  const draftIds = drafts.map((draft) => draft._id);
  const [jobs, accounts, campaigns, members, savedViews, recentActivity] = await Promise.all([
    draftIds.length ? PublishJob.find({ draftId: { $in: draftIds }, projectId: { $in: projectIds } }).select('draftId batchId status createdAt').sort({ createdAt: -1 }).lean() : [],
    projectIds.length ? SocialAccount.find({ projectId: { $in: projectIds }, ...socialAccountAccessFilter(req.user._id) }).select('projectId platform accountName status').sort({ platform: 1, accountName: 1 }).lean() : [],
    projectIds.length ? Campaign.find({ projectId: { $in: projectIds } }).select('projectId name channel status').sort({ name: 1 }).lean() : [],
    OrganizationMember.find({ organizationId: req.organization._id }).select('userId role').populate('userId', 'name email').lean(),
    CalendarSavedView.find({ organizationId: req.organization._id, userId: req.user._id }).sort({ isDefault: -1, name: 1 }).lean(),
    projectIds.length ? SocialDraftActivity.find({ projectId: { $in: projectIds } })
      .select('projectId draftId actorUserId eventType summary createdAt')
      .sort({ createdAt: -1 })
      .limit(12)
      .populate('actorUserId', 'name email')
      .populate('draftId', 'title channel')
      .lean() : []
  ]);
  const projectsById = Object.fromEntries(projects.map((project) => [String(project._id), project]));
  const accountsById = Object.fromEntries(accounts.map((account) => [String(account._id), account]));
  const items = filterAgencyCalendarItems(decorateAgencyCalendarItems({
    drafts,
    jobsByDraft: latestJobsByDraft(jobs),
    projectsById,
    accountsById
  }), filters);
  const role = `organization_${req.organizationRole}`;
  const counts = items.reduce((summary, item) => {
    summary.total += 1;
    summary[item.reviewStatus] = (summary[item.reviewStatus] || 0) + 1;
    if (item.hasAttention) summary.attention += 1;
    if (item.uiStatus === 'published') summary.published += 1;
    return summary;
  }, { total: 0, ready_for_review: 0, changes_requested: 0, scheduled: 0, attention: 0, published: 0 });
  res.render('organizations/calendar', {
    title: `${req.organization.name} calendar`,
    projects,
    accounts,
    campaigns,
    members,
    savedViews,
    recentActivity,
    filters,
    groups: Object.values(groupAgencyCalendarItems(items, filters.group)),
    counts,
    pagination: { page: filters.page, hasPreviousPage: filters.page > 1, hasNextPage },
    canManageCalendar: canChangeProjectRole(role),
    canReviewCalendar: canReviewDraftRole(role),
    canPublishCalendar: canPublishProjectRole(role),
    message: req.query.message || '',
    errorMessage: req.query.error || ''
  });
}));

router.post('/:id/calendar/views', [
  param('id').isMongoId(),
  body('name').trim().notEmpty().isLength({ max: 80 }).withMessage('Saved view name is required.'),
  handleValidation
], loadOrganization, asyncHandler(async (req, res) => {
  const filters = sanitizeSavedViewFilters(req.body);
  await CalendarSavedView.findOneAndUpdate(
    { organizationId: req.organization._id, userId: req.user._id, name: req.body.name },
    { organizationId: req.organization._id, userId: req.user._id, name: req.body.name, filters },
    { upsert: true, setDefaultsOnInsert: true, returnDocument: 'after' }
  );
  res.redirect(`/organizations/${req.organization._id}/calendar?message=${encodeURIComponent('Calendar view saved.')}`);
}));

router.post('/:id/calendar/views/:viewId/delete', [
  param('id').isMongoId(),
  param('viewId').isMongoId(),
  handleValidation
], loadOrganization, asyncHandler(async (req, res) => {
  await CalendarSavedView.deleteOne({ _id: req.params.viewId, organizationId: req.organization._id, userId: req.user._id });
  res.redirect(`/organizations/${req.organization._id}/calendar?message=${encodeURIComponent('Saved view removed.')}`);
}));

router.post('/:id/calendar/bulk-action', [
  param('id').isMongoId(),
  body('draftIds').custom((value) => {
    const values = (Array.isArray(value) ? value : [value]).filter(Boolean);
    return values.length > 0 && values.length <= 200 && values.every((id) => /^[a-f\d]{24}$/i.test(String(id)));
  }).withMessage('Select between 1 and 200 valid posts.'),
  body('action').isIn(['assign_owner', 'approve', 'schedule', 'move_campaign', 'publish', 'export']).withMessage('Choose a valid bulk action.'),
  body('assignedTo').optional({ checkFalsy: true }).isMongoId().withMessage('Choose a valid owner.'),
  body('campaignId').optional({ checkFalsy: true }).isMongoId().withMessage('Choose a valid campaign.'),
  body('scheduledAt').optional({ checkFalsy: true }).isISO8601().withMessage('Choose a valid schedule date.'),
  handleValidation
], loadOrganization, asyncHandler(async (req, res, next) => {
  const projectRows = await Project.find({ organizationId: req.organization._id }).select('_id name').lean();
  const projectIds = projectRows.map((project) => project._id);
  const projectNames = new Map(projectRows.map((project) => [String(project._id), project.name]));
  const authorizedProjectIds = new Set(projectIds.map(String));
  const selectedIds = [...new Set((Array.isArray(req.body.draftIds) ? req.body.draftIds : [req.body.draftIds]).map(String))];
  const drafts = await SocialDraft.find({ _id: { $in: selectedIds }, projectId: { $in: projectIds } }).populate('campaignId', 'name');
  const draftsById = new Map(drafts.map((draft) => [String(draft._id), draft]));
  const results = selectedIds.map((id) => {
    const draft = draftsById.get(id);
    return {
      id,
      title: draft?.title || 'Unavailable post',
      project: draft ? projectNames.get(String(draft.projectId)) || 'Client project' : '',
      ok: false,
      message: draft ? '' : 'Post is unavailable in this agency workspace.'
    };
  });
  const role = `organization_${req.organizationRole}`;
  const action = req.body.action;
  const allowed = action === 'export'
    || (action === 'approve' && canReviewDraftRole(role))
    || (action === 'publish' && canPublishProjectRole(role))
    || (['assign_owner', 'schedule', 'move_campaign'].includes(action) && canChangeProjectRole(role));
  if (!allowed) return next(new AppError('Your agency role cannot perform this bulk action.', 403));

  if (action === 'export') {
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['projectId', 'draftId', 'title', 'platform', 'campaign', 'reviewStatus', 'scheduledFor']];
    drafts.forEach((draft) => rows.push([
      draft.projectId,
      draft._id,
      draft.title,
      draft.channel,
      draft.campaignId?.name || '',
      draft.reviewStatus,
      draft.scheduledFor?.toISOString() || ''
    ]));
    res.attachment(`moyi-agency-calendar-${new Date().toISOString().slice(0, 10)}.csv`);
    return res.type('text/csv').send(rows.map((row) => row.map(escapeCsv).join(',')).join('\n'));
  }

  let validAssignee = null;
  if (action === 'assign_owner' && req.body.assignedTo) {
    validAssignee = await OrganizationMember.exists({ organizationId: req.organization._id, userId: req.body.assignedTo });
    if (!validAssignee && String(req.organization.ownerId) !== String(req.body.assignedTo)) {
      return next(new AppError('Owner must belong to this agency workspace.', 422));
    }
  }
  const campaign = action === 'move_campaign'
    ? await Campaign.findOne({ _id: req.body.campaignId, projectId: { $in: projectIds } })
    : null;
  const activeJobRows = action !== 'publish'
    ? await PublishJob.find({
      draftId: { $in: drafts.map((draft) => draft._id) },
      projectId: { $in: projectIds },
      status: { $in: ['queued', 'preparing_media', 'publishing', 'provider_processing', 'retry_wait'] }
    }).select('draftId status').lean()
    : [];
  const activeDraftIds = new Set(activeJobRows.map((job) => String(job.draftId)));

  if (action === 'publish') {
    const byProject = drafts.reduce((groups, draft) => {
      const key = String(draft.projectId);
      if (!groups[key]) groups[key] = [];
      groups[key].push(draft);
      return groups;
    }, {});
    for (const [projectId, projectDrafts] of Object.entries(byProject)) {
      if (!authorizedProjectIds.has(projectId)) continue;
      const project = await Project.findById(projectId);
      const destinationIds = await publishableProjectIds(req.user._id, { sourceProject: project });
      const draftIds = projectDrafts.map((draft) => draft._id);
      const [accounts, images, media, jobs] = await Promise.all([
        SocialAccount.find({ projectId: { $in: destinationIds }, ...socialAccountAccessFilter(req.user._id) }),
        ContentImage.find({ projectId, draftId: { $in: draftIds }, status: 'selected' }),
        MediaAsset.find({ projectId, draftId: { $in: draftIds } }),
        PublishJob.find({ projectId, draftId: { $in: draftIds } }).sort({ createdAt: -1 })
      ]);
      const group = (values) => values.reduce((map, value) => { const key = String(value.draftId); (map[key] ||= []).push(value); return map; }, {});
      const readiness = buildPublishReadiness({ socialDrafts: projectDrafts, connectedAccounts: accounts, imagesByDraftId: group(images), mediaAssetsByDraftId: group(media), jobsByDraftId: latestJobsByDraft(jobs), projectId });
      const readyIds = readiness.posts.filter((item) => item.ready).map((item) => item.draftId);
      if (readyIds.length) await createAndQueuePublishBatch({ projectId, userId: req.user._id, draftIds: readyIds, project, scheduledAt: new Date(), allowedDestinationProjectIds: destinationIds });
      results.forEach((result) => {
        if (!projectDrafts.some((draft) => String(draft._id) === result.id)) return;
        const state = readiness.posts.find((item) => item.draftId === result.id);
        result.ok = readyIds.includes(result.id);
        result.message = result.ok ? 'Publishing queued.' : (state?.blockerDetails || []).map((blocker) => blocker.message).join(' ') || 'Post is not ready to publish.';
      });
      for (const draft of projectDrafts.filter((item) => readyIds.includes(String(item._id)))) {
        await recordDraftActivity({
          draft,
          user: req.user,
          eventType: 'agency_bulk_publish',
          summary: 'Queued the post from the agency calendar.',
          req
        });
      }
    }
  } else {
    for (const result of results) {
      const draft = draftsById.get(result.id);
      if (!draft || !authorizedProjectIds.has(String(draft.projectId))) continue;
      try {
        if (activeDraftIds.has(result.id)) {
          throw new AppError('This post has an active publishing job and cannot be changed.', 409);
        }
        if (draft.publishStatus === 'published' || draft.status === 'published_manually') {
          throw new AppError('Published posts cannot be changed by a bulk action.', 409);
        }
        if (action === 'approve') applyReviewTransition(draft, { action: 'approve', actorUserId: req.user._id });
        if (action === 'assign_owner') draft.assignedTo = req.body.assignedTo || null;
        if (action === 'schedule') {
          draft.scheduledFor = validateCalendarReschedule(draft, req.body.scheduledAt);
          if (draft.status === 'approved') draft.reviewStatus = 'scheduled';
        }
        if (action === 'move_campaign') {
          if (!campaign || String(campaign.projectId) !== String(draft.projectId)) throw new AppError('Campaign belongs to a different client project.', 422);
          draft.campaignId = campaign._id;
        }
        await draft.save();
        await recordDraftActivity({ draft, user: req.user, eventType: `agency_bulk_${action}`, summary: `Agency bulk action: ${action.replace(/_/g, ' ')}.`, metadata: { assignedTo: req.body.assignedTo || '', campaignId: req.body.campaignId || '', to: req.body.scheduledAt || '' }, req });
        result.ok = true;
        result.message = 'Updated.';
      } catch (error) {
        result.message = error.message;
      }
    }
  }
  const successCount = results.filter((result) => result.ok).length;
  const failureCount = results.length - successCount;
  await recordAuditEvent({ user: req.user, eventType: 'agency_calendar_bulk_action', metadata: { organizationId: req.organization._id, action, selected: results.length, successCount, failureCount }, req });
  const failureSummary = results.filter((result) => !result.ok).slice(0, 2).map((result) => result.message).filter(Boolean).join(' ');
  const message = `${successCount} updated; ${failureCount} skipped.${failureSummary ? ` ${failureSummary}` : ''}`;
  if (wantsJson(req)) {
    return res.status(failureCount ? 207 : 200).json({
      ok: failureCount === 0,
      message,
      results
    });
  }
  res.redirect(`/organizations/${req.organization._id}/calendar?message=${encodeURIComponent(message)}`);
}));

router.get('/:id', [param('id').isMongoId(), handleValidation], loadOrganization, asyncHandler(async (req, res) => {
  const [members, projects, assignableProjects] = await Promise.all([
    OrganizationMember.find({ organizationId: req.organization._id })
      .sort({ role: 1, createdAt: 1 })
      .populate('userId', 'name email')
      .populate('invitedBy', 'name email'),
    Project.find({ organizationId: req.organization._id }).sort({ name: 1 }).lean(),
    canManageOrganizationRole(req.organizationRole)
      ? Project.find({ owner: req.user._id, organizationId: null }).select('name websiteUrl').sort({ name: 1 }).lean()
      : []
  ]);
  const agencyDashboard = await buildAgencyWorkspaceDashboard({
    organization: req.organization,
    projects
  });
  res.render('organizations/show', {
    title: req.organization.name,
    members,
    projects,
    assignableProjects,
    agencyDashboard,
    currentUserId: req.user._id,
    message: req.query.message || '',
    errorMessage: req.query.error || ''
  });
}));

router.post('/:id/members', [
  param('id').isMongoId(),
  body('email').isEmail().normalizeEmail().withMessage('Enter an existing Moyi user email.'),
  body('role').isIn(['admin', 'publisher', 'reviewer', 'analyst']).withMessage('Choose a valid agency role.'),
  handleValidation
], loadOrganization, requireOrganizationManager, asyncHandler(async (req, res) => {
  const targetUser = await User.findOne({ email: req.body.email });
  if (!targetUser) {
    return res.redirect(`/organizations/${req.organization._id}?error=${encodeURIComponent('That user does not have a Moyi account yet.')}`);
  }
  if (String(targetUser._id) === String(req.organization.ownerId)) {
    return res.redirect(`/organizations/${req.organization._id}?error=${encodeURIComponent('The agency owner already has full access.')}`);
  }
  const membership = await OrganizationMember.findOneAndUpdate(
    { organizationId: req.organization._id, userId: targetUser._id },
    {
      organizationId: req.organization._id,
      userId: targetUser._id,
      role: req.body.role,
      invitedBy: req.user._id,
      joinedAt: new Date()
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  await recordAuditEvent({
    user: req.user,
    eventType: 'organization_member_upserted',
    metadata: { organizationId: req.organization._id, memberUserId: targetUser._id, role: membership.role },
    req
  });

  const inviteUrl = `${String(env.appUrl || '').replace(/\/$/, '')}/organizations/${req.organization._id}`;
  await sendTeamInviteEmail({
    to: targetUser.email,
    inviterName: req.user.name || req.user.email,
    projectName: `${req.organization.name} (Agency Workspace)`,
    inviteUrl,
    role: membership.role
  }).catch((err) => {
    console.warn(`[OrgInviteEmail] Failed to dispatch email to ${targetUser.email}:`, err.message);
  });

  res.redirect(`/organizations/${req.organization._id}?message=${encodeURIComponent('Agency member access updated, and email notification sent.')}`);
}));

router.post('/:id/members/:memberId/remove', [
  param('id').isMongoId(),
  param('memberId').isMongoId(),
  handleValidation
], loadOrganization, requireOrganizationManager, asyncHandler(async (req, res) => {
  const member = await OrganizationMember.findOne({ _id: req.params.memberId, organizationId: req.organization._id });
  if (member && member.role === 'owner') throw new AppError('The agency owner cannot be removed.', 422);
  if (member) await member.deleteOne();
  await recordAuditEvent({
    user: req.user,
    eventType: 'organization_member_removed',
    metadata: { organizationId: req.organization._id, memberUserId: member && member.userId },
    req
  });
  res.redirect(`/organizations/${req.organization._id}?message=${encodeURIComponent('Agency member removed.')}`);
}));

router.post('/:id/projects', [
  param('id').isMongoId(),
  body('projectId').isMongoId().withMessage('Choose a valid client workspace.'),
  handleValidation
], loadOrganization, requireOrganizationManager, asyncHandler(async (req, res) => {
  const project = await Project.findOne({ _id: req.body.projectId, owner: req.user._id, organizationId: null });
  if (!project) throw new AppError('Only the project owner can assign an unassigned workspace to an agency.', 403);
  project.organizationId = req.organization._id;
  await project.save();
  await recordAuditEvent({
    user: req.user,
    projectId: project._id,
    eventType: 'project_assigned_to_organization',
    metadata: { organizationId: req.organization._id },
    req
  });
  res.redirect(`/organizations/${req.organization._id}?message=${encodeURIComponent(`${project.name} added as a client workspace.`)}`);
}));

router.post('/:id/projects/:projectId/remove', [
  param('id').isMongoId(),
  param('projectId').isMongoId(),
  handleValidation
], loadOrganization, requireOrganizationManager, asyncHandler(async (req, res) => {
  const project = await Project.findOne({
    _id: req.params.projectId,
    organizationId: req.organization._id,
    owner: req.user._id
  });
  if (!project) throw new AppError('Only the project owner can remove this client workspace from the agency.', 403);
  project.organizationId = null;
  await project.save();
  await recordAuditEvent({
    user: req.user,
    projectId: project._id,
    eventType: 'project_removed_from_organization',
    metadata: { organizationId: req.organization._id },
    req
  });
  res.redirect(`/organizations/${req.organization._id}?message=${encodeURIComponent(`${project.name} removed from the agency workspace.`)}`);
}));

module.exports = router;
