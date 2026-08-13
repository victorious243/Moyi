const Organization = require('../models/Organization');
const OrganizationMember = require('../models/OrganizationMember');
const Project = require('../models/Project');

const ORGANIZATION_ROLE_RANK = {
  analyst: 1,
  publisher: 2,
  admin: 3,
  owner: 4
};

function canPublishOrganizationRole(role) {
  return (ORGANIZATION_ROLE_RANK[role] || 0) >= ORGANIZATION_ROLE_RANK.publisher;
}

function canManageOrganizationRole(role) {
  return (ORGANIZATION_ROLE_RANK[role] || 0) >= ORGANIZATION_ROLE_RANK.admin;
}

async function organizationRole({ organizationId, userId }) {
  if (!organizationId || !userId) return '';
  const organization = await Organization.findById(organizationId).select('ownerId status').lean();
  if (!organization || organization.status !== 'active') return '';
  if (String(organization.ownerId) === String(userId)) return 'owner';
  const membership = await OrganizationMember.findOne({ organizationId, userId }).select('role').lean();
  return membership ? membership.role : '';
}

async function accessibleOrganizationIds(userId) {
  const [owned, memberships] = await Promise.all([
    Organization.find({ ownerId: userId, status: 'active' }).distinct('_id'),
    OrganizationMember.find({ userId }).distinct('organizationId')
  ]);
  const activeMembershipOrganizations = memberships.length
    ? await Organization.find({ _id: { $in: memberships }, status: 'active' }).distinct('_id')
    : [];
  return [...new Set([...owned, ...activeMembershipOrganizations].map(String))];
}

async function createOrganization({ ownerId, name }) {
  const slug = await Organization.uniqueSlug(name);
  const organization = await Organization.create({ name, slug, ownerId });
  await OrganizationMember.findOneAndUpdate(
    { organizationId: organization._id, userId: ownerId },
    { organizationId: organization._id, userId: ownerId, role: 'owner', joinedAt: new Date() },
    { upsert: true, setDefaultsOnInsert: true }
  );
  return organization;
}

async function listAccessibleOrganizations(userId) {
  const ids = await accessibleOrganizationIds(userId);
  if (!ids.length) return [];
  const organizations = await Organization.find({ _id: { $in: ids }, status: 'active' })
    .sort({ name: 1 })
    .lean();
  return Promise.all(organizations.map(async (organization) => ({
    ...organization,
    accessRole: await organizationRole({ organizationId: organization._id, userId })
  })));
}

async function manageableDestinationProjectIds(userId) {
  const organizationIds = await accessibleOrganizationIds(userId);
  if (!organizationIds.length) return [];
  const memberships = await Promise.all(organizationIds.map(async (organizationId) => ({
    organizationId,
    role: await organizationRole({ organizationId, userId })
  })));
  const publishableIds = memberships
    .filter(({ role }) => canPublishOrganizationRole(role))
    .map(({ organizationId }) => organizationId);
  if (!publishableIds.length) return [];
  return Project.distinct('_id', { organizationId: { $in: publishableIds } });
}

module.exports = {
  ORGANIZATION_ROLE_RANK,
  accessibleOrganizationIds,
  canManageOrganizationRole,
  canPublishOrganizationRole,
  createOrganization,
  listAccessibleOrganizations,
  manageableDestinationProjectIds,
  organizationRole
};
