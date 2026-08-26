const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calendarCounts,
  calendarPresentation,
  canonicalCalendarStatus,
  latestJobsByDraft,
  normalizeCalendarFilters,
  validateCalendarReschedule
} = require('../services/contentCalendarService');
const {
  addDays,
  localDateKey,
  resolveCalendarRange,
  resolveExplicitRange,
  utcForLocalDateTime
} = require('../services/calendarDateService');

const future = new Date('2030-01-02T09:00:00Z');
const past = new Date('2020-01-02T09:00:00Z');

function draft(overrides = {}) {
  return {
    _id: 'draft-1',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: past,
    errorMessage: '',
    ...overrides
  };
}

test('canonical calendar status covers the normal publishing lifecycle', () => {
  assert.equal(canonicalCalendarStatus(draft({ status: 'draft', publishStatus: 'draft' })), 'draft');
  assert.equal(canonicalCalendarStatus(draft({ status: 'draft', publishStatus: 'pending_approval' })), 'awaiting_approval');
  assert.equal(canonicalCalendarStatus(draft()), 'ready');
  assert.equal(canonicalCalendarStatus(draft({ scheduledFor: future }), { now: past }), 'scheduled');
  assert.equal(canonicalCalendarStatus(draft(), { jobs: [{ status: 'publishing' }] }), 'publishing');
  assert.equal(canonicalCalendarStatus(draft(), { jobs: [{ status: 'published' }] }), 'published');
  assert.equal(canonicalCalendarStatus(draft(), { jobs: [{ status: 'failed' }] }), 'failed');
  assert.equal(canonicalCalendarStatus(draft(), { jobs: [{ status: 'published' }, { status: 'failed' }] }), 'failed');
  assert.equal(canonicalCalendarStatus(draft(), { jobs: [{ status: 'cancelled' }] }), 'cancelled');
});

test('publishing blockers become a visible canonical blocked state', () => {
  const result = calendarPresentation(draft(), {
    readiness: { blockers: ['Connect an X account'] }
  });

  assert.equal(result.uiStatus, 'blocked');
  assert.equal(result.statusLabel, 'Blocked');
  assert.equal(result.hasAttention, true);
  assert.equal(result.blocker, 'Connect an X account');
});

test('calendar counts use canonical presentation states', () => {
  assert.deepEqual(calendarCounts([
    { uiStatus: 'scheduled' },
    { uiStatus: 'blocked' },
    { uiStatus: 'failed' },
    { uiStatus: 'published' },
    { uiStatus: 'draft' },
    { uiStatus: 'awaiting_approval' },
    { uiStatus: 'ready' }
  ]), {
    total: 7,
    scheduled: 1,
    needsAttention: 2,
    published: 1,
    drafts: 2,
    ready: 1,
    byStatus: {
      scheduled: 1,
      blocked: 1,
      failed: 1,
      published: 1,
      draft: 1,
      awaiting_approval: 1,
      ready: 1
    }
  });
});

test('latest jobs groups only the newest batch for each draft', () => {
  const grouped = latestJobsByDraft([
    { draftId: 'a', batchId: 'new', status: 'failed' },
    { draftId: 'a', batchId: 'new', status: 'published' },
    { draftId: 'a', batchId: 'old', status: 'published' },
    { draftId: 'b', batchId: 'only', status: 'queued' }
  ]);

  assert.equal(grouped.a.length, 2);
  assert.equal(grouped.b.length, 1);
  assert.ok(grouped.a.every((job) => job.batchId === 'new'));
});

test('calendar filters are normalized and invalid states are ignored', () => {
  assert.deepEqual(normalizeCalendarFilters({
    search: ' launch ',
    status: 'scheduled',
    platform: 'linkedin',
    campaign: 'campaign-1',
    account: 'account-1',
    contentType: 'carousel',
    view: 'month',
    date: '2026-08-25',
    page: '3'
  }), {
    search: 'launch',
    status: 'scheduled',
    platform: 'linkedin',
    campaign: 'campaign-1',
    account: 'account-1',
    contentType: 'carousel',
    view: 'month',
    date: '2026-08-25',
    page: 3
  });
  assert.equal(normalizeCalendarFilters({ status: 'not-real' }).status, '');
  assert.equal(normalizeCalendarFilters({ view: 'attention' }).view, 'attention');
});

test('calendar ranges handle month boundaries and six-row months', () => {
  const august = resolveCalendarRange({ view: 'month', date: '2026-08-25', timezone: 'UTC' });
  assert.equal(august.fromKey, '2026-07-27');
  assert.equal(august.toKeyExclusive, '2026-09-07');
  assert.equal(august.days, 42);
  assert.equal(addDays(august.toKeyExclusive, -1), '2026-09-06');
});

test('timezone conversion preserves local midnight across DST boundaries', () => {
  const spring = resolveExplicitRange({ from: '2026-03-08', to: '2026-03-08', timezone: 'America/New_York' });
  assert.equal(spring.from.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(spring.to.toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal((spring.to - spring.from) / 3600000, 23);
  const autumn = resolveExplicitRange({ from: '2026-10-25', to: '2026-10-25', timezone: 'Europe/Dublin' });
  assert.equal((autumn.to - autumn.from) / 3600000, 25);
});

test('timezone conversion keeps midnight posts on the intended project date', () => {
  const scheduled = utcForLocalDateTime('2026-08-25', '00:00', 'Asia/Tokyo');
  assert.equal(scheduled.toISOString(), '2026-08-24T15:00:00.000Z');
  assert.equal(localDateKey(scheduled, 'Asia/Tokyo'), '2026-08-25');
});

test('explicit calendar ranges reject excessive and reversed windows', () => {
  assert.throws(() => resolveExplicitRange({ from: '2026-01-01', to: '2026-05-01', timezone: 'UTC' }), /cannot exceed 93 days/);
  assert.throws(() => resolveExplicitRange({ from: '2026-08-25', to: '2026-08-24', timezone: 'UTC' }), /on or after/);
});

test('rescheduling permits failed drafts but rejects published and active posts', () => {
  const now = new Date('2026-08-25T12:00:00.000Z');
  assert.equal(validateCalendarReschedule(draft({ publishStatus: 'failed' }), '2026-08-26T12:00:00.000Z', now).toISOString(), '2026-08-26T12:00:00.000Z');
  assert.throws(() => validateCalendarReschedule(draft({ publishStatus: 'published' }), '2026-08-26T12:00:00.000Z', now), /cannot be rescheduled/);
  assert.throws(() => validateCalendarReschedule(draft({ publishStatus: 'publishing' }), '2026-08-26T12:00:00.000Z', now), /active publishing jobs/);
});
