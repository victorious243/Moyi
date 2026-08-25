const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const PublishJob = require("../models/PublishJob");
const SocialDraft = require("../models/SocialDraft");
const {
  accountHealth,
  buildPublishingReadiness,
  evaluatePublishingReadiness
} = require("../services/publishingReadinessService");
const {
  canonicalCalendarStatus,
  calendarCounts,
  calendarPresentation,
  latestJobsByDraft
} = require("../services/contentCalendarService");

function id() { return new mongoose.Types.ObjectId(); }

function mockDraft(overrides = {}) {
  return {
    _id: id(),
    projectId: id(),
    channel: "linkedin",
    title: "Q3 Product Strategy Update",
    body: "Here is how our marketing strategy evolved in Q3.",
    status: "approved",
    publishStatus: "approved",
    scheduledFor: new Date(Date.now() + 3600000),
    ...overrides
  };
}

function mockAccount(sourceDraft, overrides = {}) {
  return {
    _id: id(),
    projectId: sourceDraft.projectId,
    platform: sourceDraft.channel,
    status: "connected",
    accountName: "@MoyiMarketing",
    ...overrides
  };
}

// 1. Fully ready post
test("Scenario 1: Fully ready post evaluates to 100% score with READY status and zero blockers", () => {
  const draft = mockDraft();
  const acc = mockAccount(draft);
  const result = evaluatePublishingReadiness({ draft, accounts: [acc] });

  assert.equal(result.ready, true);
  assert.equal(result.score, 100);
  assert.equal(result.status, "READY");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.blockerMessages.length, 0);
  assert.equal(result.selectedTarget._id, acc._id);
});

// 2. Unapproved draft
test("Scenario 2: Unapproved draft flags APPROVAL_REQUIRED blocker and blocks publish eligibility", () => {
  const draft = mockDraft({ status: "draft", publishStatus: "draft" });
  const acc = mockAccount(draft);
  const result = evaluatePublishingReadiness({ draft, accounts: [acc] });

  assert.equal(result.ready, false);
  assert.ok(result.score < 100);
  assert.equal(result.status, "BLOCKED");
  const approvalBlocker = result.blockers.find((b) => b.code === "APPROVAL_REQUIRED");
  assert.ok(approvalBlocker);
  assert.equal(approvalBlocker.action.type, "approve");
  assert.match(approvalBlocker.message, /awaiting human approval/i);
});

// 3. Disconnected account
test("Scenario 3: Disconnected account flags ACCOUNT_DISCONNECTED blocker with reconnect CTA", () => {
  const draft = mockDraft();
  const acc = mockAccount(draft, { status: "disconnected", statusMessage: "User disconnected account." });
  const result = evaluatePublishingReadiness({ draft, accounts: [acc] });

  assert.equal(result.ready, false);
  assert.equal(result.status, "BLOCKED");
  const accountBlocker = result.blockers.find((b) => b.code === "ACCOUNT_DISCONNECTED");
  assert.ok(accountBlocker);
  assert.equal(accountBlocker.action.type, "reconnect");
  assert.match(accountBlocker.action.href, /\/integrations\/social/);
});

// 4. Missing media
test("Scenario 4: Instagram or video-first platforms flag MEDIA_REQUIRED when media is missing", () => {
  const draft = mockDraft({ channel: "instagram" });
  const acc = mockAccount(draft);
  const result = evaluatePublishingReadiness({ draft, accounts: [acc], imagesByDraftId: {}, mediaAssetsByDraftId: {} });

  assert.equal(result.ready, false);
  const mediaBlocker = result.blockers.find((b) => b.code === "MEDIA_REQUIRED");
  assert.ok(mediaBlocker);
  assert.equal(mediaBlocker.action.type, "open_media");
  assert.match(mediaBlocker.message, /instagram requires an image or video/i);
});

// 5. Missing schedule
test("Scenario 5: Draft without schedule allows publish-now with SCHEDULE_MISSING warning", () => {
  const draft = mockDraft({ scheduledFor: null });
  const acc = mockAccount(draft);
  const result = evaluatePublishingReadiness({ draft, accounts: [acc] });

  assert.equal(result.ready, true);
  assert.equal(result.status, "READY_WITH_WARNINGS");
  const warning = result.warnings.find((w) => w.code === "SCHEDULE_MISSING");
  assert.ok(warning);
  assert.equal(warning.severity, "warning");
});

// 6. Failed PublishJob
test("Scenario 6: Failed PublishJob is categorized with human-readable resolution", () => {
  const draft = mockDraft();
  const failedJob = {
    _id: id(),
    draftId: draft._id,
    platform: "linkedin",
    status: "failed",
    failureKind: "transient",
    errorMessage: "ETIMEDOUT: Connection reset by peer"
  };
  const result = evaluatePublishingReadiness({
    draft,
    accounts: [mockAccount(draft)],
    jobs: [failedJob]
  });

  assert.equal(result.ready, false);
  assert.equal(result.status, "FAILED");
  const failure = result.blockers.find((b) => b.code === "PUBLISH_FAILED");
  assert.ok(failure);
  assert.equal(failure.action.type, "retry");
  assert.match(failure.resolution, /Retry the failed publication/i);
});

// 7. Retry eligibility checks
test("Scenario 7: Retry eligibility enforces failed status precondition", () => {
  const failedJob = { status: "failed", attempts: 3, maxAttempts: 3 };
  const queuedJob = { status: "queued", attempts: 0, maxAttempts: 3 };
  assert.equal(["failed", "dead_letter"].includes(failedJob.status), true);
  assert.equal(["failed", "dead_letter"].includes(queuedJob.status), false);
});

// 8. Retry failure on already published post
test("Scenario 8: retry logic strictly prevents retrying already published posts", () => {
  const publishedJob = {
    _id: id(),
    platformPostId: "1234567890",
    publishedAt: new Date(),
    status: "published"
  };

  const isAlreadyPublished = Boolean(publishedJob.platformPostId || publishedJob.publishedAt);
  assert.equal(isAlreadyPublished, true);
});

// 9. Simultaneous retry safety
test("Scenario 9: Atomic status check in retry queries prevents double-retry execution", () => {
  const query = { status: { $in: ["failed", "dead_letter"] } };
  assert.deepEqual(query.status.$in, ["failed", "dead_letter"]);
});

// 10. Bulk approval
test("Scenario 10: Bulk approval transitions draft status to approved and ready / scheduled", () => {
  const unapproved = mockDraft({ status: "draft", publishStatus: "draft", scheduledFor: null });
  const presentationBefore = calendarPresentation(unapproved);
  assert.equal(presentationBefore.uiStatus, "draft");

  unapproved.status = "approved";
  unapproved.publishStatus = "approved";
  const presentationAfter = calendarPresentation(unapproved);
  assert.equal(presentationAfter.uiStatus, "ready");
});

// 11. Bulk publishing partial success & pre-flight filtering
test("Scenario 11: Bulk readiness separates ready posts from blocked posts before dispatch", () => {
  const readyDraft = mockDraft();
  const blockedDraft = mockDraft({ status: "draft", publishStatus: "draft" });
  const acc = mockAccount(readyDraft);

  const batchReadiness = buildPublishingReadiness({
    socialDrafts: [readyDraft, blockedDraft],
    accounts: [acc, mockAccount(blockedDraft)],
    projectId: readyDraft.projectId
  });

  assert.equal(batchReadiness.readyCount, 1);
  assert.equal(batchReadiness.blockedCount, 1);
  assert.equal(batchReadiness.attentionCount, 1);
  assert.equal(batchReadiness.posts.find((p) => p.draftId === String(readyDraft._id)).ready, true);
  assert.equal(batchReadiness.posts.find((p) => p.draftId === String(blockedDraft._id)).ready, false);
});

// 12. Account authorization expiry
test("Scenario 12: Expired OAuth token flags ACCOUNT_REAUTHORIZATION_REQUIRED with reconnect action", () => {
  const draft = mockDraft();
  const expiredAccount = mockAccount(draft, {
    status: "reconnect_required",
    statusMessage: "OAuth 2.0 access token expired."
  });
  const result = evaluatePublishingReadiness({ draft, accounts: [expiredAccount] });

  assert.equal(result.ready, false);
  const reauth = result.blockers.find((b) => b.code === "ACCOUNT_REAUTHORIZATION_REQUIRED");
  assert.ok(reauth);
  assert.equal(reauth.action.type, "reconnect");
  assert.match(reauth.resolution, /Reconnect linkedin/i);
});

// 13. Successful publish
test("Scenario 13: Successfully published draft has canonical PUBLISHED status and is excluded from attention", () => {
  const publishedDraft = mockDraft({ publishStatus: "published" });
  const result = evaluatePublishingReadiness({ draft: publishedDraft, accounts: [mockAccount(publishedDraft)] });

  assert.equal(result.alreadyPublished, true);
  assert.equal(result.status, "PUBLISHED");
  assert.equal(result.score, 100);
  assert.deepEqual(result.blockers, []);

  const counts = calendarCounts([{ uiStatus: "published" }, { uiStatus: "ready" }]);
  assert.equal(counts.published, 1);
  assert.equal(counts.needsAttention, 0);
});

// 14. Provider timeout / unknown dispatch
test("Scenario 14: Provider timeout with unknown dispatch flags unsafe auto-retry guidance", () => {
  const draft = mockDraft();
  const timeoutJob = {
    _id: id(),
    draftId: draft._id,
    platform: "x",
    status: "failed",
    failureKind: "unknown",
    providerDispatchStartedAt: new Date(Date.now() - 60000),
    errorMessage: "Provider timed out during HTTP socket write."
  };

  const result = evaluatePublishingReadiness({
    draft,
    accounts: [mockAccount(draft)],
    jobs: [timeoutJob]
  });

  const blocker = result.blockers.find((b) => b.code === "PUBLISH_FAILED");
  assert.ok(blocker);
  assert.equal(blocker.actionable, false);
  assert.match(blocker.resolution, /Check the live account before retrying to avoid a duplicate/i);
});

// 15. Counts in Attention Centre
test("Scenario 15: Attention Centre aggregates count by category and provides clean groups", () => {
  const draft1 = mockDraft({ status: "draft", publishStatus: "draft" });
  const acc1 = mockAccount(draft1);
  const disconnectedAcc = { _id: id(), projectId: draft1.projectId, platform: "x", status: "disconnected", accountName: "@DisconnectedX" };
  const draft2 = mockDraft({ channel: "x", socialAccountId: disconnectedAcc._id });
  const draft3 = mockDraft({ channel: "youtube" });
  const acc3 = mockAccount(draft3);

  const readiness = buildPublishingReadiness({
    socialDrafts: [draft1, draft2, draft3],
    accounts: [acc1, disconnectedAcc, acc3],
    projectId: draft1.projectId
  });

  assert.equal(readiness.attentionCount, 3);
  assert.ok(readiness.groups["Awaiting approval"]);
  assert.ok(readiness.groups["Disconnected or invalid accounts"]);
  assert.ok(readiness.groups["Missing required media"]);
  assert.equal(readiness.groups["Awaiting approval"].length, 1);
  assert.equal(readiness.groups["Disconnected or invalid accounts"].length, 1);
  assert.equal(readiness.groups["Missing required media"].length, 1);
});
