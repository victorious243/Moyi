const NotificationEndpoint = require('../models/NotificationEndpoint');
const NotificationRoute = require('../models/NotificationRoute');
const OrganizationMember = require('../models/OrganizationMember');
const ProjectMember = require('../models/ProjectMember');
const User = require('../models/User');

const CHANNEL_CONFIG_KEYS = {
  in_app: 'inApp',
  email: 'email',
  slack: 'slack',
  teams: 'teams',
  discord: 'discord',
  webhook: 'webhook'
};

function enabledProjectChannels(project) {
  const configured = project && project.cmoNotifications && project.cmoNotifications.channels;
  if (!configured) return ['in_app', 'email'];
  return Object.entries(CHANNEL_CONFIG_KEYS)
    .filter(([, key]) => configured[key] !== false && (['inApp', 'email'].includes(key) || configured[key] === true))
    .map(([channel]) => channel);
}

async function projectStakeholders(project) {
  const directMembers = await ProjectMember.find({ projectId: project._id }).select('userId').lean();
  const organizationMembers = project.organizationId
    ? await OrganizationMember.find({ organizationId: project.organizationId }).select('userId').lean()
    : [];
  const ids = [...new Set([
    String(project.owner && project.owner._id ? project.owner._id : project.owner),
    ...directMembers.map((item) => String(item.userId)),
    ...organizationMembers.map((item) => String(item.userId))
  ].filter(Boolean))];
  return User.find({ _id: { $in: ids } }).select('name email').lean();
}

function selectRoutedStakeholders({ project, route, stakeholders, allowedChannels, category = 'general' }) {
  const ownerId = String(project.owner && project.owner._id ? project.owner._id : project.owner);
  const requestedChannels = route && route.channels && route.channels.length
    ? route.channels
    : ['in_app', 'email'];
  const channels = requestedChannels.filter((channel) => allowedChannels.includes(channel));
  if (route && route.enabled === false) {
    return { channels: [], users: [], emails: [] };
  }

  const selectedIds = new Set((route && route.memberIds || []).map(String));
  if (!route || route.includeOwner !== false) selectedIds.add(ownerId);
  const users = stakeholders.filter((user) => selectedIds.has(String(user._id)));
  const legacyBriefingEmails = !route && category === 'executive_briefing' && project.cmoNotifications && project.cmoNotifications.weeklyBriefing
    ? project.cmoNotifications.weeklyBriefing.recipientEmails || []
    : [];
  const emails = [...new Set([
    ...users.map((user) => String(user.email || '').trim().toLowerCase()),
    ...(route && route.externalEmails || []).map((email) => String(email).trim().toLowerCase()),
    ...legacyBriefingEmails.map((email) => String(email).trim().toLowerCase())
  ].filter(Boolean))];
  return { channels, users, emails };
}

async function resolveNotificationRouting({ project, category = 'general' }) {
  const route = await NotificationRoute.findOne({ projectId: project._id, category }).lean();
  const allowedChannels = enabledProjectChannels(project);
  const stakeholders = await projectStakeholders(project);
  const { channels, users, emails } = selectRoutedStakeholders({
    project,
    route,
    stakeholders,
    allowedChannels,
    category
  });
  const endpointIds = route && route.endpointIds ? route.endpointIds : [];
  const endpoints = endpointIds.length
    ? await NotificationEndpoint.find({
        _id: { $in: endpointIds },
        projectId: project._id,
        status: 'active',
        channel: { $in: channels }
      }).lean()
    : [];

  return { route, channels, users, emails, endpoints };
}

module.exports = {
  enabledProjectChannels,
  projectStakeholders,
  resolveNotificationRouting,
  selectRoutedStakeholders
};
