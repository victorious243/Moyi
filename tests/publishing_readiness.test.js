const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { accountHealth, buildPublishingReadiness, evaluatePublishingReadiness } = require('../services/publishingReadinessService');

function id() { return new mongoose.Types.ObjectId(); }

function draft(overrides = {}) {
  return {
    _id: id(),
    projectId: id(),
    channel: 'linkedin',
    title: 'A useful post',
    body: 'Evidence-led content.',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date(Date.now() + 3600000),
    ...overrides
  };
}

function account(sourceDraft, overrides = {}) {
  return {
    _id: id(),
    projectId: sourceDraft.projectId,
    platform: sourceDraft.channel,
    status: 'connected',
    accountName: 'Moyi',
    ...overrides
  };
}

test('publishing readiness is deterministic and fully ready only without critical blockers', () => {
  const post = draft();
  const result = evaluatePublishingReadiness({ draft: post, accounts: [account(post)] });
  assert.equal(result.ready, true);
  assert.equal(result.score, 100);
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.warnings.length, 0);
});

test('approval, account, media and expiry produce structured operational blockers', () => {
  const post = draft({ channel: 'instagram', status: 'draft', publishStatus: 'draft' });
  const expired = account(post, { status: 'reconnect_required', statusMessage: 'Provider revoked access.' });
  const result = evaluatePublishingReadiness({ draft: post, accounts: [expired] });
  assert.equal(result.ready, false);
  assert.ok(result.score < 100);
  assert.deepEqual(result.blockers.map((item) => item.code), [
    'APPROVAL_REQUIRED',
    'ACCOUNT_REAUTHORIZATION_REQUIRED',
    'MEDIA_REQUIRED'
  ]);
  assert.equal(result.blockers[1].action.type, 'reconnect');
});

test('failed jobs are categorized and counted once in the attention centre', () => {
  const post = draft();
  const failedJob = {
    _id: id(),
    draftId: post._id,
    platform: 'linkedin',
    status: 'dead_letter',
    reconnectRequired: true,
    failureKind: 'authentication',
    errorMessage: 'Expired token'
  };
  const result = buildPublishingReadiness({
    socialDrafts: [post],
    accounts: [account(post)],
    jobsByDraftId: { [String(post._id)]: [failedJob] },
    projectId: post.projectId
  });
  assert.equal(result.attentionCount, 1);
  assert.equal(result.blockerCounts.PUBLISH_FAILED, 1);
  assert.equal(result.groups['Publishing failures'].length, 1);
  assert.match(result.posts[0].blockers.at(-1).resolution, /Reconnect/);
});

test('stored account health never performs a provider request', () => {
  assert.equal(accountHealth(null).status, 'unknown');
  assert.equal(accountHealth({ status: 'disconnected' }).status, 'disconnected');
  assert.equal(accountHealth({ status: 'error', statusMessage: 'Refresh failed' }).message, 'Refresh failed');
  assert.equal(accountHealth({ status: 'connected', tokenExpiresAt: new Date(0) }).refreshDue, true);
});

test('published and in-flight jobs are not offered as ready or attention items', () => {
  const published = draft({ publishStatus: 'published' });
  const active = draft({ publishStatus: 'queued' });
  const result = buildPublishingReadiness({
    socialDrafts: [published, active],
    accounts: [account(published), account(active)]
  });
  assert.equal(result.readyCount, 0);
  assert.equal(result.attentionCount, 0);
  assert.equal(result.publishedCount, 1);
  assert.equal(result.inFlightCount, 1);
});
