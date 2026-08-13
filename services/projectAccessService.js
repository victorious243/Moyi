const Project = require('../models/Project');
const ProjectMember = require('../models/ProjectMember');
const {
  accessibleOrganizationIds,
  canPublishOrganizationRole,
  organizationRole
} = require('./organizationService');

function isUnsafeMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

function canManageProjectRole(role) {
  return role === 'owner' || role === 'admin';
}

async function accessibleProjectIds(userId) {
  const [ownedProjects, memberships, organizationIds] = await Promise.all([
    Project.find({ owner: userId }).select('_id').lean(),
    ProjectMember.find({ userId }).select('projectId').lean(),
    accessibleOrganizationIds(userId)
  ]);
  const organizationProjects = organizationIds.length
    ? await Project.find({ organizationId: { $in: organizationIds } }).select('_id').lean()
    : [];

  return [...new Map([
    ...ownedProjects.map((project) => project._id),
    ...memberships.map((membership) => membership.projectId),
    ...organizationProjects.map((project) => project._id)
  ].map((projectId) => [String(projectId), projectId])).values()];
}

async function publishableProjectIds(userId, { sourceProject = null, sourceProjectId = null } = {}) {
  const source = sourceProject || (sourceProjectId ? await Project.findById(sourceProjectId).select('organizationId owner').lean() : null);
  if (source && source.organizationId) {
    const role = await organizationRole({ organizationId: source.organizationId, userId });
    if (canPublishOrganizationRole(role)) {
      return Project.distinct('_id', { organizationId: source.organizationId });
    }
    if (String(source.owner) === String(userId)) return [source._id];
    const directMembership = await ProjectMember.findOne({
      projectId: source._id,
      userId,
      role: 'admin'
    }).select('_id').lean();
    return directMembership ? [source._id] : [];
  }

  const [ownedProjects, memberships, organizationIds] = await Promise.all([
    Project.find({ owner: userId }).select('_id').lean(),
    ProjectMember.find({ userId, role: 'admin' }).select('projectId').lean(),
    accessibleOrganizationIds(userId)
  ]);
  const publishableOrganizations = [];
  for (const organizationId of organizationIds) {
    const role = await organizationRole({ organizationId, userId });
    if (canPublishOrganizationRole(role)) publishableOrganizations.push(organizationId);
  }
  const organizationProjects = publishableOrganizations.length
    ? await Project.find({ organizationId: { $in: publishableOrganizations } }).select('_id').lean()
    : [];
  return [...new Map([
    ...ownedProjects.map((project) => [String(project._id), project._id]),
    ...memberships.map((membership) => [String(membership.projectId), membership.projectId]),
    ...organizationProjects.map((project) => [String(project._id), project._id])
  ]).values()];
}

function buildAccessibleProjectFilter({ userId, memberProjectIds = [], query = {} }) {
  return {
    ...query,
    $or: [
      { owner: userId },
      { _id: { $in: memberProjectIds } }
    ]
  };
}

async function findAccessibleProjects(userId, options = {}) {
  const {
    query = {},
    sort = {},
    limit = 0,
    select = ''
  } = options;
  const projectIds = await accessibleProjectIds(userId);
  let projectQuery = Project.find({ ...query, _id: { $in: projectIds } });

  if (select) projectQuery = projectQuery.select(select);
  if (Object.keys(sort).length) projectQuery = projectQuery.sort(sort);
  if (limit) projectQuery = projectQuery.limit(limit);

  return projectQuery;
}

async function projectAccessRole({ project, projectId, userId }) {
  const targetProject = project || await Project.findById(projectId);
  if (!targetProject) return '';
  if (String(targetProject.owner) === String(userId)) return 'owner';

  const membership = await ProjectMember.findOne({ projectId: targetProject._id, userId }).lean();
  if (membership) return membership.role;
  if (targetProject.organizationId) {
    const role = await organizationRole({ organizationId: targetProject.organizationId, userId });
    return role ? `organization_${role}` : '';
  }
  return '';
}

function canPublishProjectRole(role) {
  return canManageProjectRole(role) || ['organization_owner', 'organization_admin', 'organization_publisher'].includes(role);
}

function canChangeProjectRole(role) {
  return canManageProjectRole(role) || ['organization_owner', 'organization_admin'].includes(role);
}

module.exports = {
  accessibleProjectIds,
  buildAccessibleProjectFilter,
  canManageProjectRole,
  canChangeProjectRole,
  canPublishProjectRole,
  findAccessibleProjects,
  isUnsafeMethod,
  projectAccessRole,
  publishableProjectIds
};
