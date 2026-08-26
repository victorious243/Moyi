const { legacyReviewStatus, reviewLabel } = require('./calendarCollaborationService');
const { calendarPresentation } = require('./contentCalendarService');

const MAX_AGENCY_CALENDAR_DAYS = 93;
const MAX_AGENCY_CALENDAR_ITEMS = 500;

function validObjectId(value) {
  return /^[a-f\d]{24}$/i.test(String(value || ''));
}

function normalizeAgencyCalendarFilters(query = {}) {
  const value = (key, length = 120) => String(query[key] || '').trim().slice(0, length);
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  const defaultTo = new Date(today.getFullYear(), today.getMonth() + 2, 1);
  const parseDate = (input, fallback) => /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T00:00:00.000Z`) : fallback;
  const from = parseDate(value('from', 10), defaultFrom);
  const requestedTo = parseDate(value('to', 10), defaultTo);
  const maximumTo = new Date(from.getTime() + MAX_AGENCY_CALENDAR_DAYS * 86400000);
  const to = requestedTo > from && requestedTo <= maximumTo ? requestedTo : maximumTo;
  return {
    project: validObjectId(value('project')) ? value('project') : '',
    platform: value('platform', 40),
    campaign: validObjectId(value('campaign')) ? value('campaign') : '',
    account: validObjectId(value('account')) ? value('account') : '',
    status: value('status', 40),
    owner: validObjectId(value('owner')) ? value('owner') : '',
    approval: ['draft', 'ready_for_review', 'changes_requested', 'approved', 'scheduled'].includes(value('approval')) ? value('approval') : '',
    search: value('search', 160),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    group: ['date', 'campaign', 'project'].includes(value('group')) ? value('group') : 'date',
    page: Math.min(Math.max(Number.parseInt(value('page', 5), 10) || 1, 1), 1000)
  };
}

function buildAgencyDraftQuery({ projectIds, filters }) {
  const from = new Date(`${filters.from}T00:00:00.000Z`);
  const toExclusive = new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86400000);
  const authorizedIds = projectIds.map(String);
  const selectedProjects = filters.project && authorizedIds.includes(String(filters.project))
    ? [filters.project]
    : projectIds;
  const query = {
    projectId: { $in: selectedProjects },
    scheduledFor: { $gte: from, $lt: toExclusive }
  };
  if (filters.platform) query.channel = filters.platform;
  if (filters.campaign) query.campaignId = filters.campaign;
  if (filters.account) query.socialAccountId = filters.account;
  if (filters.owner) query.assignedTo = filters.owner;
  // Apply approval filtering after legacy workflow states have been normalized.
  if (filters.search) {
    const escaped = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [{ title: new RegExp(escaped, 'i') }, { body: new RegExp(escaped, 'i') }];
  }
  return query;
}

function decorateAgencyCalendarItems({ drafts = [], jobsByDraft = {}, projectsById = {}, accountsById = {} }) {
  return drafts.map((draft) => {
    const presentation = calendarPresentation(draft, { jobs: jobsByDraft[String(draft._id)] || [] });
    const reviewStatus = legacyReviewStatus(draft);
    return {
      draft,
      project: projectsById[String(draft.projectId)] || null,
      account: accountsById[String(draft.socialAccountId || '')] || null,
      reviewStatus,
      reviewLabel: reviewLabel(reviewStatus),
      ...presentation
    };
  });
}

function filterAgencyCalendarItems(items, filters) {
  return items
    .filter((item) => !filters.status || item.uiStatus === filters.status)
    .filter((item) => !filters.approval || item.reviewStatus === filters.approval);
}

function groupAgencyCalendarItems(items, group = 'date') {
  return items.reduce((groups, item) => {
    let key;
    let label;
    if (group === 'campaign') {
      key = String(item.draft.campaignId?._id || item.draft.campaignId || 'uncampaigned');
      label = item.draft.campaignId?.name || 'No campaign';
    } else if (group === 'project') {
      key = String(item.project?._id || 'unknown');
      label = item.project?.name || 'Unknown project';
    } else {
      key = item.draft.scheduledFor ? new Date(item.draft.scheduledFor).toISOString().slice(0, 10) : 'unscheduled';
      label = key === 'unscheduled' ? 'Unscheduled' : new Date(`${key}T12:00:00.000Z`).toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' });
    }
    if (!groups[key]) groups[key] = { key, label, items: [], readyCount: 0, platformCounts: {} };
    groups[key].items.push(item);
    if (['ready', 'scheduled', 'published'].includes(item.uiStatus)) groups[key].readyCount += 1;
    const platform = String(item.draft.channel || 'other');
    groups[key].platformCounts[platform] = (groups[key].platformCounts[platform] || 0) + 1;
    return groups;
  }, {});
}

function sanitizeSavedViewFilters(filters = {}) {
  const normalized = normalizeAgencyCalendarFilters(filters);
  delete normalized.page;
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== ''));
}

module.exports = {
  MAX_AGENCY_CALENDAR_DAYS,
  MAX_AGENCY_CALENDAR_ITEMS,
  buildAgencyDraftQuery,
  decorateAgencyCalendarItems,
  filterAgencyCalendarItems,
  groupAgencyCalendarItems,
  normalizeAgencyCalendarFilters,
  sanitizeSavedViewFilters,
  validObjectId
};
