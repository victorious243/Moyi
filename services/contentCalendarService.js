const ACTIVE_JOB_STATUSES = new Set(['queued', 'preparing_media', 'publishing', 'provider_processing', 'retry_wait']);
const FAILED_JOB_STATUSES = new Set(['failed', 'dead_letter', 'expired']);

const UI_STATES = Object.freeze({
  DRAFT: 'draft',
  AWAITING_APPROVAL: 'awaiting_approval',
  READY: 'ready',
  SCHEDULED: 'scheduled',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

const UI_STATE_META = Object.freeze({
  draft: { label: 'Draft', tone: 'neutral' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'warning' },
  ready: { label: 'Ready', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  publishing: { label: 'Publishing', tone: 'info' },
  published: { label: 'Published', tone: 'success' },
  blocked: { label: 'Blocked', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' }
});

function latestJobsByDraft(jobs = []) {
  const latestBatchIds = new Map();
  return jobs.reduce((grouped, job) => {
    const draftId = String(job.draftId || '');
    if (!draftId) return grouped;
    if (!latestBatchIds.has(draftId)) latestBatchIds.set(draftId, String(job.batchId || ''));
    if (latestBatchIds.get(draftId) !== String(job.batchId || '')) return grouped;
    if (!grouped[draftId]) grouped[draftId] = [];
    grouped[draftId].push(job);
    return grouped;
  }, {});
}

function canonicalCalendarStatus(draft, { jobs = [], readiness = null, now = new Date() } = {}) {
  // Priority: published > active job > cancelled > failed > approval > blockers > schedule > ready.
  const publishStatus = String(draft.publishStatus || '');
  const jobStatuses = jobs.map((job) => String(job.status || ''));
  const blockers = readiness && Array.isArray(readiness.blockerDetails)
    ? readiness.blockerDetails
    : readiness && Array.isArray(readiness.blockers) ? readiness.blockers : [];

  if (draft.status === 'published_manually' || publishStatus === 'published') {
    return UI_STATES.PUBLISHED;
  }
  if (jobStatuses.some((status) => ACTIVE_JOB_STATUSES.has(status)) || ['queued', 'publishing'].includes(publishStatus)) {
    return UI_STATES.PUBLISHING;
  }
  if (jobStatuses.length && jobStatuses.every((status) => status === 'cancelled')) return UI_STATES.CANCELLED;
  if (publishStatus === 'failed' || jobStatuses.some((status) => FAILED_JOB_STATUSES.has(status))) return UI_STATES.FAILED;
  if (jobStatuses.includes('published')) return UI_STATES.PUBLISHED;
  if (draft.status === 'draft') {
    return publishStatus === 'pending_approval' ? UI_STATES.AWAITING_APPROVAL : UI_STATES.DRAFT;
  }
  if (blockers.length && !blockers.every((item) => ['Already published', 'Publishing in progress'].includes(typeof item === 'string' ? item : item.message))) {
    return UI_STATES.BLOCKED;
  }
  if (draft.scheduledFor && new Date(draft.scheduledFor).getTime() > now.getTime()) return UI_STATES.SCHEDULED;
  return UI_STATES.READY;
}

function calendarPresentation(draft, options = {}) {
  const uiStatus = canonicalCalendarStatus(draft, options);
  const meta = UI_STATE_META[uiStatus];
  const blockerDetails = options.readiness && Array.isArray(options.readiness.blockerDetails)
    ? options.readiness.blockerDetails
    : [];
  const blockers = options.readiness && Array.isArray(options.readiness.blockers)
    ? options.readiness.blockers.filter((item) => !['Already published', 'Publishing in progress'].includes(item))
    : [];
  const errorMessage = String(draft.errorMessage || '').trim();

  return {
    uiStatus,
    statusLabel: meta.label,
    statusTone: meta.tone,
    blocker: blockerDetails[0]?.message || blockers[0] || (uiStatus === UI_STATES.FAILED ? errorMessage || 'Publishing failed' : ''),
    blockers,
    blockerDetails,
    readinessScore: options.readiness?.score ?? null,
    hasAttention: [UI_STATES.BLOCKED, UI_STATES.FAILED].includes(uiStatus),
    isPublished: uiStatus === UI_STATES.PUBLISHED,
    isPublishing: uiStatus === UI_STATES.PUBLISHING,
    canSelect: ![UI_STATES.PUBLISHED, UI_STATES.PUBLISHING, UI_STATES.CANCELLED].includes(uiStatus)
  };
}

function calendarCounts(items = []) {
  return items.reduce((counts, item) => {
    counts.total += 1;
    counts.byStatus[item.uiStatus] = (counts.byStatus[item.uiStatus] || 0) + 1;
    if (item.uiStatus === UI_STATES.SCHEDULED) counts.scheduled += 1;
    if ([UI_STATES.BLOCKED, UI_STATES.FAILED].includes(item.uiStatus)) counts.needsAttention += 1;
    if (item.uiStatus === UI_STATES.PUBLISHED) counts.published += 1;
    if ([UI_STATES.DRAFT, UI_STATES.AWAITING_APPROVAL].includes(item.uiStatus)) counts.drafts += 1;
    if (item.uiStatus === UI_STATES.READY) counts.ready += 1;
    return counts;
  }, {
    total: 0,
    scheduled: 0,
    needsAttention: 0,
    published: 0,
    drafts: 0,
    ready: 0,
    byStatus: {}
  });
}

function normalizeCalendarFilters(query = {}) {
  const value = (name) => String(query[name] || '').trim();
  const validStates = new Set(Object.values(UI_STATES));
  return {
    search: value('search').slice(0, 160),
    status: validStates.has(value('status')) ? value('status') : '',
    platform: value('platform').slice(0, 40),
    campaign: value('campaign').slice(0, 80),
    account: value('account').slice(0, 80),
    contentType: value('contentType').slice(0, 80),
    view: ['today', 'week', 'month', 'list', 'attention'].includes(value('view')) ? value('view') : 'list',
    date: value('date').slice(0, 10),
    page: Math.max(1, Number.parseInt(value('page'), 10) || 1)
  };
}

function validateCalendarReschedule(draft, scheduledFor, now = new Date()) {
  if (draft.status === 'published_manually' || draft.publishStatus === 'published') {
    const error = new Error('Published posts cannot be rescheduled.');
    error.statusCode = 409;
    throw error;
  }
  if (ACTIVE_JOB_STATUSES.has(String(draft.publishStatus || ''))) {
    const error = new Error('Wait for active publishing jobs to finish before rescheduling this post.');
    error.statusCode = 409;
    throw error;
  }
  const date = new Date(scheduledFor);
  const maximumDistance = 5 * 365 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(date.getTime()) || Math.abs(date.getTime() - now.getTime()) > maximumDistance) {
    const error = new Error('Choose a schedule date within five years.');
    error.statusCode = 422;
    throw error;
  }
  return date;
}

module.exports = {
  ACTIVE_JOB_STATUSES,
  UI_STATES,
  UI_STATE_META,
  calendarCounts,
  calendarPresentation,
  canonicalCalendarStatus,
  latestJobsByDraft,
  normalizeCalendarFilters,
  validateCalendarReschedule
};
