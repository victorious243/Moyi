const { NATIVE_SOCIAL_PLATFORMS } = require('./socialAccountService');
const { xPostLimitMessage, xPostMetrics, X_STANDARD_MAX_WEIGHTED_LENGTH } = require('./xTextService');

const ACTIVE_JOB_STATUSES = new Set(['queued', 'preparing_media', 'publishing', 'provider_processing', 'retry_wait']);
const FAILED_JOB_STATUSES = new Set(['failed', 'dead_letter', 'expired']);

const CHECK_WEIGHTS = Object.freeze({
  approval: 20,
  copy: 15,
  account: 25,
  media: 20,
  schedule: 10,
  job: 10
});

const BLOCKER_GROUPS = Object.freeze({
  PUBLISH_FAILED: 'Publishing failures',
  ACCOUNT_REAUTHORIZATION_REQUIRED: 'Disconnected or invalid accounts',
  ACCOUNT_DISCONNECTED: 'Disconnected or invalid accounts',
  ACCOUNT_ERROR: 'Disconnected or invalid accounts',
  ACCOUNT_NOT_CONNECTED: 'Disconnected or invalid accounts',
  MEDIA_REQUIRED: 'Missing required media',
  MEDIA_FAILED: 'Missing required media',
  APPROVAL_REQUIRED: 'Awaiting approval',
  SCHEDULE_INVALID: 'Invalid schedule',
  COPY_REQUIRED: 'Content issues',
  X_COPY_TOO_LONG: 'Content issues',
  X_COPY_INVALID: 'Content issues',
  PLATFORM_UNSUPPORTED: 'Other blockers'
});

const BLOCKER_PRIORITY = Object.freeze([
  'PUBLISH_FAILED',
  'ACCOUNT_REAUTHORIZATION_REQUIRED', 'ACCOUNT_DISCONNECTED', 'ACCOUNT_ERROR', 'ACCOUNT_NOT_CONNECTED',
  'MEDIA_FAILED', 'MEDIA_REQUIRED',
  'APPROVAL_REQUIRED',
  'SCHEDULE_INVALID',
  'COPY_REQUIRED', 'X_COPY_TOO_LONG', 'X_COPY_INVALID', 'PLATFORM_UNSUPPORTED'
]);

function accountHealth(account, now = new Date()) {
  if (!account) return { status: 'unknown', label: 'Unknown', message: 'Moyi could not identify an account for this post.' };
  if (account.status === 'reconnect_required') {
    return { status: 'reauthorization_required', label: 'Needs reauthorization', message: account.statusMessage || 'Authorization has expired or was revoked.' };
  }
  if (account.status === 'disconnected') {
    return { status: 'disconnected', label: 'Disconnected', message: account.statusMessage || 'This account is disconnected.' };
  }
  if (account.status === 'error') {
    return { status: 'error', label: 'Error', message: account.statusMessage || 'The latest account health check failed.' };
  }
  if (account.status !== 'connected') {
    return { status: 'unknown', label: 'Unknown', message: account.statusMessage || 'Account health is unknown.' };
  }
  const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
  const refreshDue = expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt <= now;
  return {
    status: 'connected',
    label: 'Connected',
    message: refreshDue ? 'The access token is due for refresh before the next provider request.' : 'Stored account state is connected.',
    refreshDue: Boolean(refreshDue)
  };
}

function issue(code, message, resolution, options = {}) {
  return {
    code,
    severity: options.severity || 'critical',
    message,
    resolution,
    actionable: options.actionable !== false,
    action: options.action || null,
    technicalDetail: options.technicalDetail || ''
  };
}

function mediaState(draft, imagesByDraftId = {}, mediaAssetsByDraftId = {}) {
  const images = imagesByDraftId[String(draft._id)] || [];
  const assets = mediaAssetsByDraftId[String(draft._id)] || [];
  const usableImages = images.filter((image) => image.status === 'selected');
  const usableAssets = assets.filter((asset) => !['failed', 'rejected'].includes(asset.status));
  return {
    hasImage: usableImages.some((image) => !draft.contentImageId || String(image._id) === String(draft.contentImageId)) || usableAssets.some((asset) => asset.kind === 'image'),
    hasVideo: usableAssets.some((asset) => asset.kind === 'video'),
    processing: usableAssets.some((asset) => ['queued', 'processing'].includes(asset.status)),
    failed: assets.length > 0 && usableAssets.length === 0
  };
}

function humanFailure(job, projectId) {
  if (!job || !FAILED_JOB_STATUSES.has(String(job.status || ''))) return null;
  const platform = String(job.platform || 'provider');
  const detail = String(job.errorMessage || job.deadLetterReason || 'Publishing failed.').slice(0, 1200);
  const reconnect = Boolean(job.reconnectRequired || job.failureKind === 'authentication');
  if (reconnect) {
    return issue(
      'PUBLISH_FAILED',
      `${platform} authorization needs attention.`,
      `Reconnect ${platform}, then retry this publication.`,
      { action: { type: 'reconnect', label: `Reconnect ${platform}`, href: `/projects/${job.destinationProjectId || projectId}/integrations/social` }, technicalDetail: detail }
    );
  }
  if (job.failureKind === 'billing') {
    return issue('PUBLISH_FAILED', `${platform} rejected the request because provider billing or credits are unavailable.`, 'Restore provider credits before retrying.', { actionable: false, technicalDetail: detail });
  }
  if (/media|image|video|aspect|ratio|codec|duration|size/i.test(`${job.errorCode || ''} ${detail}`)) {
    return issue('PUBLISH_FAILED', `${platform} rejected the selected media.`, 'Open the post, replace or reprocess the media, then retry.', { action: { type: 'open_media', label: 'Fix media' }, technicalDetail: detail });
  }
  if (job.failureKind === 'unknown' && job.providerDispatchStartedAt) {
    return issue('PUBLISH_FAILED', `${platform} did not confirm whether the post was created.`, 'Check the live account before retrying to avoid a duplicate.', { actionable: false, technicalDetail: detail });
  }
  const retryable = ['transient', 'rate_limit'].includes(job.failureKind) || job.status === 'failed';
  return issue('PUBLISH_FAILED', `${platform} publishing failed.`, retryable ? 'Retry the failed publication.' : 'Review the provider detail before retrying.', {
    actionable: retryable,
    action: retryable ? { type: 'retry', label: 'Retry', jobId: String(job._id || '') } : null,
    technicalDetail: detail
  });
}

function evaluatePublishingReadiness({
  draft,
  accounts = [],
  imagesByDraftId = {},
  mediaAssetsByDraftId = {},
  jobs = [],
  projectId = draft && draft.projectId,
  now = new Date()
}) {
  const supportedPlatforms = NATIVE_SOCIAL_PLATFORMS.includes(draft.channel) ? [draft.channel] : [];
  const candidateAccounts = accounts.filter((account) => supportedPlatforms.includes(account.platform));
  const selectedAccount = draft.socialAccountId
    ? candidateAccounts.find((account) => String(account._id) === String(draft.socialAccountId)) || null
    : candidateAccounts.find((account) => account.status === 'connected') || candidateAccounts[0] || null;
  const health = accountHealth(selectedAccount, now);
  const blockers = [];
  const warnings = [];
  const checks = [];
  const addCheck = (key, passed, label, detail = '') => checks.push({ key, weight: CHECK_WEIGHTS[key], passed, label, detail });
  const alreadyPublished = draft.publishStatus === 'published' || draft.status === 'published_manually' || jobs.some((job) => job.status === 'published');
  const inFlight = ACTIVE_JOB_STATUSES.has(String(draft.publishStatus || '')) || jobs.some((job) => ACTIVE_JOB_STATUSES.has(String(job.status || '')));

  if (alreadyPublished) {
    return { draftId: String(draft._id), ready: false, score: 100, status: 'PUBLISHED', blockers: [], blockerMessages: ['Already published'], warnings, checks, supportedPlatforms, targets: candidateAccounts.filter((account) => account.status === 'connected'), selectedTarget: selectedAccount, accountHealth: health, alreadyPublished: true };
  }
  if (inFlight) {
    return { draftId: String(draft._id), ready: false, score: 100, status: 'PUBLISHING', blockers: [], blockerMessages: ['Publishing in progress'], warnings, checks, supportedPlatforms, targets: candidateAccounts.filter((account) => account.status === 'connected'), selectedTarget: selectedAccount, accountHealth: health, inFlight: true };
  }

  const approved = draft.status === 'approved' && ['approved', 'failed'].includes(String(draft.publishStatus || ''));
  addCheck('approval', approved, 'Human approval', approved ? 'Approved' : 'Awaiting approval');
  if (!approved) blockers.push(issue('APPROVAL_REQUIRED', 'This post is awaiting human approval.', 'Review and approve the post before publishing.', { action: { type: 'approve', label: 'Review post' } }));

  const hasCopy = Boolean(String(draft.title || '').trim() || String(draft.body || '').trim());
  addCheck('copy', hasCopy, 'Post copy', hasCopy ? 'Copy is available' : 'No title or caption');
  if (!hasCopy) blockers.push(issue('COPY_REQUIRED', 'The post has no publishable copy.', 'Add a title or caption before publishing.', { action: { type: 'edit', label: 'Add copy' } }));

  const platformSupported = supportedPlatforms.length > 0;
  if (!platformSupported) blockers.push(issue('PLATFORM_UNSUPPORTED', 'The selected channel is not supported by Moyi publishing.', 'Choose a supported social platform.', { action: { type: 'edit', label: 'Choose platform' } }));
  const accountReady = platformSupported && health.status === 'connected';
  addCheck('account', accountReady, 'Publishing account', health.message);
  if (platformSupported && !selectedAccount) {
    blockers.push(issue('ACCOUNT_NOT_CONNECTED', `No ${draft.channel} account is connected.`, `Connect ${draft.channel} before publishing.`, { action: { type: 'reconnect', label: `Connect ${draft.channel}`, href: `/projects/${projectId}/integrations/social` } }));
  } else if (health.status === 'reauthorization_required') {
    blockers.push(issue('ACCOUNT_REAUTHORIZATION_REQUIRED', `${draft.channel} authorization has expired or was revoked.`, `Reconnect ${draft.channel} before publishing.`, { action: { type: 'reconnect', label: `Reconnect ${draft.channel}`, href: `/projects/${selectedAccount.projectId || projectId}/integrations/social` } }));
  } else if (health.status === 'disconnected') {
    blockers.push(issue('ACCOUNT_DISCONNECTED', `The selected ${draft.channel} account is disconnected.`, `Reconnect ${draft.channel} before publishing.`, { action: { type: 'reconnect', label: `Reconnect ${draft.channel}`, href: `/projects/${selectedAccount.projectId || projectId}/integrations/social` } }));
  } else if (health.status === 'error') {
    blockers.push(issue('ACCOUNT_ERROR', `Moyi recorded an error for the selected ${draft.channel} account.`, health.message, { action: { type: 'reconnect', label: `Review ${draft.channel}`, href: `/projects/${selectedAccount.projectId || projectId}/integrations/social` } }));
  }
  if (health.refreshDue) warnings.push(issue('TOKEN_REFRESH_DUE', `${draft.channel} credentials are due for refresh.`, 'Moyi will refresh them before publishing.', { severity: 'warning', actionable: false }));

  const media = mediaState(draft, imagesByDraftId, mediaAssetsByDraftId);
  const mediaRequired = ['instagram', 'tiktok', 'youtube'].includes(draft.channel);
  const mediaReady = draft.channel === 'youtube' ? media.hasVideo : !mediaRequired || media.hasImage || media.hasVideo;
  addCheck('media', mediaReady, 'Required media', mediaReady ? (media.processing ? 'Media is processing' : 'Media is available') : 'Required media is missing');
  if (!mediaReady) {
    const requirement = draft.channel === 'youtube' ? 'a video' : 'an image or video';
    blockers.push(issue(media.failed ? 'MEDIA_FAILED' : 'MEDIA_REQUIRED', `${draft.channel} requires ${requirement}.`, 'Open the post and add valid media.', { action: { type: 'open_media', label: 'Add media' } }));
  } else if (media.processing) {
    warnings.push(issue('MEDIA_PROCESSING', 'Media processing is still in progress.', 'Moyi will queue publishing after the required variants are ready.', { severity: 'warning', actionable: false }));
  }

  const schedule = draft.scheduledFor ? new Date(draft.scheduledFor) : null;
  const scheduleValid = !schedule || Number.isFinite(schedule.getTime());
  addCheck('schedule', scheduleValid, 'Schedule', !schedule ? 'Publish-now is available' : scheduleValid ? 'Schedule is valid' : 'Schedule is invalid');
  if (!scheduleValid) blockers.push(issue('SCHEDULE_INVALID', 'The planned publishing date is invalid.', 'Choose a valid date and time.', { action: { type: 'schedule', label: 'Fix schedule' } }));
  if (!schedule) warnings.push(issue('SCHEDULE_MISSING', 'No planned publishing time is set.', 'Choose a schedule or use Publish now.', { severity: 'warning', action: { type: 'schedule', label: 'Choose time' } }));

  let textMetrics = null;
  if (draft.channel === 'x') {
    textMetrics = { ...xPostMetrics(draft.body), maxWeightedLength: X_STANDARD_MAX_WEIGHTED_LENGTH };
    if (textMetrics.weightedLength > X_STANDARD_MAX_WEIGHTED_LENGTH) blockers.push(issue('X_COPY_TOO_LONG', xPostLimitMessage(textMetrics.weightedLength), 'Shorten the X post before publishing.', { action: { type: 'edit', label: 'Shorten copy' } }));
    else if (!textMetrics.valid) blockers.push(issue('X_COPY_INVALID', 'X post copy contains unsupported control characters.', 'Remove unsupported characters and try again.', { action: { type: 'edit', label: 'Fix copy' } }));
  }

  const latestFailure = jobs.find((job) => FAILED_JOB_STATUSES.has(String(job.status || ''))) || (draft.publishStatus === 'failed' ? { platform: draft.channel, status: 'failed', errorMessage: draft.errorMessage, failureKind: '' } : null);
  const failure = humanFailure(latestFailure, projectId);
  addCheck('job', !failure, 'Publishing history', failure ? failure.message : 'No unresolved publishing failure');
  if (failure) blockers.push(failure);

  const earned = checks.reduce((total, check) => total + (check.passed ? check.weight : 0), 0);
  const possible = checks.reduce((total, check) => total + check.weight, 0) || 1;
  const score = Math.round((earned / possible) * 100);
  return {
    draftId: String(draft._id),
    channel: draft.channel,
    ready: blockers.length === 0,
    score,
    status: blockers.length ? (failure ? 'FAILED' : 'BLOCKED') : warnings.length ? 'READY_WITH_WARNINGS' : 'READY',
    blockers,
    blockerMessages: blockers.map((item) => item.message),
    warnings,
    checks,
    supportedPlatforms,
    targets: candidateAccounts.filter((account) => account.status === 'connected'),
    selectedTarget: selectedAccount && selectedAccount.status === 'connected' ? selectedAccount : null,
    accountHealth: health,
    textMetrics,
    inFlight: false,
    alreadyPublished: false
  };
}

function buildPublishingReadiness({ socialDrafts = [], accounts = [], imagesByDraftId = {}, mediaAssetsByDraftId = {}, jobsByDraftId = {}, projectId = '' }) {
  const posts = socialDrafts.map((draft) => evaluatePublishingReadiness({
    draft,
    accounts,
    imagesByDraftId,
    mediaAssetsByDraftId,
    jobs: jobsByDraftId[String(draft._id)] || [],
    projectId: projectId || draft.projectId
  }));
  const actionable = posts.filter((post) => !post.ready && !post.inFlight && !post.alreadyPublished);
  const groups = actionable.reduce((result, post) => {
    const codes = new Set(post.blockers.map((blocker) => blocker.code));
    const primaryCode = BLOCKER_PRIORITY.find((code) => codes.has(code)) || post.blockers[0]?.code;
    const label = BLOCKER_GROUPS[primaryCode] || 'Other blockers';
    post.primaryBlockerCode = primaryCode;
    post.primaryBlocker = post.blockers.find((blocker) => blocker.code === primaryCode) || post.blockers[0] || null;
    if (!result[label]) result[label] = [];
    result[label].push(post);
    return result;
  }, {});
  const blockerCounts = actionable.reduce((counts, post) => {
    post.blockers.forEach((blocker) => { counts[blocker.code] = (counts[blocker.code] || 0) + 1; });
    return counts;
  }, {});
  return {
    posts,
    readyCount: posts.filter((post) => post.ready).length,
    blockedCount: actionable.length,
    inFlightCount: posts.filter((post) => post.inFlight).length,
    publishedCount: posts.filter((post) => post.alreadyPublished).length,
    attentionCount: actionable.length,
    blockerCounts,
    groups,
    attentionSummary: Object.entries(groups).map(([label, groupedPosts]) => ({ label, count: groupedPosts.length })),
    missingConnections: [...new Set(actionable.filter((post) => post.blockers.some((item) => item.code === 'ACCOUNT_NOT_CONNECTED')).map((post) => post.channel))]
  };
}

module.exports = {
  ACTIVE_JOB_STATUSES,
  BLOCKER_GROUPS,
  BLOCKER_PRIORITY,
  CHECK_WEIGHTS,
  accountHealth,
  buildPublishingReadiness,
  evaluatePublishingReadiness,
  humanFailure
};
