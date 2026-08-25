const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const Organization = require('../models/Organization');
const OrganizationMember = require('../models/OrganizationMember');
const Project = require('../models/Project');
const User = require('../models/User');
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
  body('role').isIn(['admin', 'publisher', 'analyst']).withMessage('Choose a valid agency role.'),
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
