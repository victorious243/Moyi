const Organization = require('../models/Organization');
const OrganizationMember = require('../models/OrganizationMember');
const Project = require('../models/Project');
const User = require('../models/User');
const Usage = require('../models/Usage');
const SocialAccount = require('../models/SocialAccount');
const SocialDraft = require('../models/SocialDraft');
const PublishJob = require('../models/PublishJob');
const { planFor } = require('../config/plans');
const { currentPeriod, socialPostAllowance } = require('./usageService');

const ORGANIZATION_ROLE_RANK = {
  analyst: 1,
  reviewer: 2,
  publisher: 2,
  admin: 3,
  owner: 4
};

const AGENCY_ROLE_CAPABILITIES = [
  {
    role: 'owner',
    approval: true,
    publishing: true,
    accounts: true,
    reporting: true,
    billing: true
  },
  {
    role: 'admin',
    approval: true,
    publishing: true,
    accounts: true,
    reporting: true,
    billing: false
  },
  {
    role: 'publisher',
    approval: false,
    publishing: true,
    accounts: false,
    reporting: true,
    billing: false
  },
  {
    role: 'reviewer',
    approval: true,
    publishing: false,
    accounts: false,
    reporting: true,
    billing: false
  },
  {
    role: 'analyst',
    approval: false,
    publishing: false,
    accounts: false,
    reporting: true,
    billing: false
  }
];

function canPublishOrganizationRole(role) {
  return ['owner', 'admin', 'publisher'].includes(role);
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

function projectKey(value) {
  return String(value && value._id ? value._id : value);
}

function summarizeAgencyUsagePool({ owner, usage }) {
  const plan = planFor(owner);
  const socialPostsAllowed = socialPostAllowance(plan, usage);
  return {
    owner: owner ? { id: String(owner._id), name: owner.name, email: owner.email } : null,
    planKey: plan.key,
    planName: plan.name,
    socialPosts: {
      used: Number(usage.socialPostsUsed || 0),
      allowed: socialPostsAllowed,
      remaining: Math.max(socialPostsAllowed - Number(usage.socialPostsUsed || 0), 0),
      extraCredits: Number(usage.extraSocialPostCredits || 0)
    },
    projects: {
      allowed: Number(plan.projectLimit || 0)
    },
    scans: {
      used: Number(usage.scansUsed || 0),
      allowed: Number(plan.scansPerMonth || 0)
    },
    contentDrafts: {
      used: Number(usage.contentDraftsUsed || 0),
      allowed: Number(plan.contentDraftsPerMonth || 0)
    },
    aiReports: {
      used: Number(usage.aiReportsUsed || 0),
      allowed: Number(plan.aiReportsPerMonth || 0)
    }
  };
}

function summarizeAgencyClientReports({ projects = [], accounts = [], publishJobs = [], approvedDraftCounts = new Map(), workflowCounts = new Map() }) {
  const accountGroups = new Map();
  const jobGroups = new Map();
  accounts.forEach((account) => {
    const key = projectKey(account.projectId);
    if (!accountGroups.has(key)) accountGroups.set(key, []);
    accountGroups.get(key).push(account);
  });
  publishJobs.forEach((job) => {
    const key = projectKey(job.destinationProjectId || job.projectId);
    if (!jobGroups.has(key)) jobGroups.set(key, []);
    jobGroups.get(key).push(job);
  });

  return projects.map((project) => {
    const key = projectKey(project);
    const projectAccounts = accountGroups.get(key) || [];
    const jobs = jobGroups.get(key) || [];
    const publishedJobs = jobs.filter((job) => job.status === 'published');
    const measuredJobs = publishedJobs.filter((job) => ['active', 'limited', 'complete'].includes(job.metricsStatus));
    const failedJobs = jobs.filter((job) => ['dead_letter', 'failed'].includes(job.status));
    const reconnectAccounts = projectAccounts.filter((account) => account.status === 'reconnect_required');
    const platforms = [...new Set(projectAccounts.map((account) => account.platform))].sort();
    const lastMetricsSyncAt = projectAccounts
      .map((account) => account.lastMetricsSyncAt)
      .filter(Boolean)
      .sort((left, right) => new Date(right) - new Date(left))[0] || null;
    const workflow = workflowCounts.get(key) || {};

    return {
      projectId: project._id,
      name: project.name,
      websiteUrl: project.websiteUrl,
      owner: project.owner,
      connectedAccounts: projectAccounts.length,
      reconnectRequired: reconnectAccounts.length,
      platforms,
      approvedDrafts: Number(approvedDraftCounts.get(key) || 0),
      pendingReview: Number(workflow.pendingReview || 0),
      changesRequested: Number(workflow.changesRequested || 0),
      scheduledPosts: Number(workflow.scheduledPosts || 0),
      calendarFailures: Number(workflow.calendarFailures || 0),
      publishedPosts: publishedJobs.length,
      measuredPosts: measuredJobs.length,
      failedJobs: failedJobs.length,
      lastMetricsSyncAt
    };
  });
}

async function buildAgencyWorkspaceDashboard({ organization, projects }) {
  const projectIds = projects.map((project) => project._id);
  const { periodStart, periodEnd } = currentPeriod();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [owner, usage, accounts, publishJobs, approvedDrafts, workflowRows] = await Promise.all([
    User.findById(organization.ownerId).select('name email plan').lean(),
    Usage.findOne({ userId: organization.ownerId, periodStart, periodEnd }).lean(),
    projectIds.length
      ? SocialAccount.find({ projectId: { $in: projectIds } })
        .select('projectId platform status metricsStatus lastMetricsSyncAt')
        .lean()
      : [],
    projectIds.length
      ? PublishJob.find({
        $or: [
          { destinationProjectId: { $in: projectIds } },
          { projectId: { $in: projectIds }, destinationProjectId: null },
          { projectId: { $in: projectIds }, destinationProjectId: { $exists: false } }
        ],
        createdAt: { $gte: since }
      })
        .select('projectId destinationProjectId status metricsStatus createdAt')
        .lean()
      : [],
    projectIds.length
      ? SocialDraft.aggregate([
        {
          $match: {
            projectId: { $in: projectIds },
            status: 'approved',
            publishStatus: { $in: ['approved', 'failed'] }
          }
        },
        { $group: { _id: '$projectId', count: { $sum: 1 } } }
      ])
      : [],
    projectIds.length
      ? SocialDraft.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        { $group: {
          _id: '$projectId',
          pendingReview: { $sum: { $cond: [{ $or: [{ $eq: ['$reviewStatus', 'ready_for_review'] }, { $eq: ['$publishStatus', 'pending_approval'] }] }, 1, 0] } },
          changesRequested: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'changes_requested'] }, 1, 0] } },
          scheduledPosts: { $sum: { $cond: [{ $and: [{ $or: [{ $in: ['$reviewStatus', ['approved', 'scheduled']] }, { $eq: ['$status', 'approved'] }] }, { $gt: ['$scheduledFor', now] }, { $lte: ['$scheduledFor', nextWeek] }] }, 1, 0] } },
          calendarFailures: { $sum: { $cond: [{ $eq: ['$publishStatus', 'failed'] }, 1, 0] } }
        } }
      ])
      : []
  ]);
  const usageDoc = usage || {
    userId: organization.ownerId,
    periodStart,
    periodEnd,
    scansUsed: 0,
    aiReportsUsed: 0,
    contentDraftsUsed: 0,
    socialPostsUsed: 0,
    extraSocialPostCredits: 0
  };
  const approvedDraftCounts = new Map(approvedDrafts.map((row) => [String(row._id), row.count]));
  const workflowCounts = new Map(workflowRows.map((row) => [String(row._id), row]));
  const clients = summarizeAgencyClientReports({
    projects,
    accounts,
    publishJobs,
    approvedDraftCounts,
    workflowCounts
  });
  return {
    usagePool: summarizeAgencyUsagePool({ owner, usage: usageDoc }),
    clients,
    totals: {
      connectedAccounts: clients.reduce((total, client) => total + client.connectedAccounts, 0),
      reconnectRequired: clients.reduce((total, client) => total + client.reconnectRequired, 0),
      approvedDrafts: clients.reduce((total, client) => total + client.approvedDrafts, 0),
      publishedPosts: clients.reduce((total, client) => total + client.publishedPosts, 0),
      measuredPosts: clients.reduce((total, client) => total + client.measuredPosts, 0),
      failedJobs: clients.reduce((total, client) => total + client.failedJobs, 0),
      pendingReview: clients.reduce((total, client) => total + client.pendingReview, 0),
      changesRequested: clients.reduce((total, client) => total + client.changesRequested, 0),
      scheduledPosts: clients.reduce((total, client) => total + client.scheduledPosts, 0),
      calendarFailures: clients.reduce((total, client) => total + client.calendarFailures, 0),
      attentionClients: clients.filter((client) => client.reconnectRequired || client.pendingReview || client.changesRequested || client.calendarFailures || client.failedJobs).length
    },
    roleCapabilities: AGENCY_ROLE_CAPABILITIES
  };
}

module.exports = {
  AGENCY_ROLE_CAPABILITIES,
  ORGANIZATION_ROLE_RANK,
  accessibleOrganizationIds,
  buildAgencyWorkspaceDashboard,
  canManageOrganizationRole,
  canPublishOrganizationRole,
  createOrganization,
  listAccessibleOrganizations,
  manageableDestinationProjectIds,
  organizationRole,
  summarizeAgencyClientReports,
  summarizeAgencyUsagePool
};
