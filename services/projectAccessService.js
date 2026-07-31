const Project = require('../models/Project');
const ProjectMember = require('../models/ProjectMember');

function isUnsafeMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

function canManageProjectRole(role) {
  return role === 'owner' || role === 'admin';
}

async function accessibleProjectIds(userId) {
  const [ownedProjects, memberships] = await Promise.all([
    Project.find({ owner: userId }).select('_id').lean(),
    ProjectMember.find({ userId }).select('projectId').lean()
  ]);

  return [
    ...ownedProjects.map((project) => project._id),
    ...memberships.map((membership) => membership.projectId)
  ];
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
  const memberProjectIds = await ProjectMember.distinct('projectId', { userId });
  let projectQuery = Project.find(buildAccessibleProjectFilter({ userId, memberProjectIds, query }));

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
  return membership ? membership.role : '';
}

module.exports = {
  accessibleProjectIds,
  buildAccessibleProjectFilter,
  canManageProjectRole,
  findAccessibleProjects,
  isUnsafeMethod,
  projectAccessRole
};
