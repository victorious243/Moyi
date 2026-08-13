const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const SocialAccount = require('../models/SocialAccount');
const SocialDraft = require('../models/SocialDraft');
const PublishAction = require('../models/PublishAction');
const PublishBatch = require('../models/PublishBatch');
const PublishJob = require('../models/PublishJob');
const Project = require('../models/Project');

const {
  connectSocialApiAccount,
  connectSocialWebhook,
  disconnectSocialAccount,
  getDecryptedSocialAccountCredentials,
  listProjectSocialAccounts
} = require('../services/socialAccountService');

const {
  assertHumanApproved,
  batchPublishSocialDrafts,
  buildPublishReadiness,
  buildPostPayload,
  publishSocialDraft,
  selectConnectedSocialAccount,
  targetPlatformsForChannel
} = require('../services/socialPublisherService');
const {
  createPublishBatch
} = require('../services/contentDistributionEngineService');

const {
  buildLinkedInAuthUrl,
  buildMetaAuthUrl,
  buildTwitterAuthUrl,
  exchangeMetaCode,
  generateTwitterPkcePair
} = require('../services/socialOauthService');
const env = require('../config/env');

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/moyi';
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 1500 });
    } catch (error) {
      // MongoDB not available in this runner; tests will mock or use validateSync
    }
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('socialOauthService: generates 1-click OAuth URLs for platforms', () => {
  env.linkedinClientId = 'test-linkedin-client-id';
  env.twitterClientId = 'test-twitter-client-id';
  env.metaAppId = 'test-meta-app-id';

  const linkedinUrl = buildLinkedInAuthUrl({ state: 'state123' });
  assert.match(linkedinUrl, /linkedin.com\/oauth\/v2\/authorization/);
  assert.match(linkedinUrl, /client_id=test-linkedin-client-id/);
  assert.match(linkedinUrl, /state=state123/);

  const pkce = generateTwitterPkcePair();
  assert.ok(pkce.verifier);
  assert.ok(pkce.challenge);

  const twitterUrl = buildTwitterAuthUrl({ state: 'state456', codeChallenge: pkce.challenge });
  assert.match(twitterUrl, /twitter.com\/i\/oauth2\/authorize/);
  assert.match(twitterUrl, /client_id=test-twitter-client-id/);
  assert.match(twitterUrl, /code_challenge_method=S256/);

  const metaUrl = buildMetaAuthUrl({ state: 'state789' });
  assert.match(metaUrl, /facebook.com\/v25.0\/dialog\/oauth/);
  assert.match(metaUrl, /client_id=test-meta-app-id/);
  assert.match(metaUrl, /instagram_content_publish/);
  assert.match(metaUrl, /pages_manage_posts/);
});

test('socialOauthService: Meta sandbox returns separate Facebook and Instagram publishing targets', async () => {
  const payload = await exchangeMetaCode('sandbox_meta_code');

  assert.equal(payload.platform, 'facebook');
  assert.equal(payload.accounts.length, 2);
  assert.deepEqual(payload.accounts.map((account) => account.platform), ['facebook', 'instagram']);
  assert.equal(payload.accounts[1].externalAccountId, 'meta_sandbox_instagram_id');
});

test('socialPublisherService: channel target platform order is explicit', () => {
  assert.deepEqual(targetPlatformsForChannel('instagram'), ['instagram']);
  assert.deepEqual(targetPlatformsForChannel('facebook'), ['facebook']);
  assert.deepEqual(targetPlatformsForChannel('youtube'), ['youtube']);
  assert.deepEqual(targetPlatformsForChannel('email'), ['webhook']);
});

test('socialPublisherService: publish readiness explains one-click blockers', () => {
  const projectId = new mongoose.Types.ObjectId();
  const campaignId = new mongoose.Types.ObjectId();

  const linkedinDraft = new SocialDraft({
    _id: new mongoose.Types.ObjectId(),
    projectId,
    campaignId,
    channel: 'linkedin',
    title: 'Approved LinkedIn',
    body: 'Ready copy',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  const instagramDraft = new SocialDraft({
    _id: new mongoose.Types.ObjectId(),
    projectId,
    campaignId,
    channel: 'instagram',
    title: 'Approved Instagram',
    body: 'Needs visual',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  const draftNeedingApproval = new SocialDraft({
    _id: new mongoose.Types.ObjectId(),
    projectId,
    campaignId,
    channel: 'x',
    title: 'Unreviewed X',
    body: 'Needs review',
    status: 'draft',
    publishStatus: 'draft',
    scheduledFor: new Date()
  });

  const connectedAccounts = [
    new SocialAccount({
      _id: new mongoose.Types.ObjectId(),
      projectId,
      userId: new mongoose.Types.ObjectId(),
      platform: 'linkedin',
      accountName: 'Company Page',
      accessToken: 'sandbox_linkedin'
    }),
    new SocialAccount({
      _id: new mongoose.Types.ObjectId(),
      projectId,
      userId: new mongoose.Types.ObjectId(),
      platform: 'instagram',
      accountName: 'Instagram Business',
      accessToken: 'sandbox_meta'
    })
  ];

  const readiness = buildPublishReadiness({
    socialDrafts: [linkedinDraft, instagramDraft, draftNeedingApproval],
    connectedAccounts,
    imagesByDraftId: {}
  });

  assert.equal(readiness.readyCount, 1);
  assert.equal(readiness.blockedCount, 2);
  assert.equal(readiness.publishedCount, 0);
  assert.deepEqual(readiness.missingConnections, ['x']);

  const instagram = readiness.posts.find((post) => post.channel === 'instagram');
  assert.equal(instagram.ready, false);
  assert.ok(instagram.blockers.includes('Instagram needs media'));
});

test('SocialAccount model validation and schema defaults', () => {
  const account = new SocialAccount({
    projectId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    platform: 'linkedin',
    accountName: 'Acme LinkedIn Page',
    accessToken: 'encrypted-token-value'
  });

  assert.equal(account.validateSync(), undefined);
  assert.equal(account.platform, 'linkedin');
  assert.equal(account.status, 'connected');

  account.platform = 'invalid_platform';
  assert.ok(account.validateSync().errors.platform);
});

test('SocialDraft multi-platform publishing schema fields', () => {
  const draft = new SocialDraft({
    projectId: new mongoose.Types.ObjectId(),
    campaignId: new mongoose.Types.ObjectId(),
    channel: 'linkedin',
    title: 'Multi-platform release',
    body: 'Content copy here',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  assert.equal(draft.validateSync(), undefined);
  assert.equal(draft.publishStatus, 'approved');

  draft.publishStatus = 'invalid_status';
  assert.ok(draft.validateSync().errors.publishStatus);
});

test('Content Distribution Engine schema tracks batches and per-platform jobs', () => {
  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const draftId = new mongoose.Types.ObjectId();
  const accountId = new mongoose.Types.ObjectId();

  const batch = new PublishBatch({
    projectId,
    userId,
    draftIds: [draftId],
    platforms: ['linkedin', 'x'],
    scheduledAt: new Date(),
    status: 'queued',
    summary: { total: 2, successCount: 0, failedCount: 0 }
  });

  assert.equal(batch.validateSync(), undefined);

  const job = new PublishJob({
    batchId: batch._id,
    projectId,
    userId,
    draftId,
    accountId,
    platform: 'linkedin',
    content: {
      title: 'Launch update',
      body: 'Approved post copy',
      imageUrl: '/social-drafts/image/file',
      imageAlt: 'Product screenshot'
    },
    status: 'queued',
    attempts: 0
  });

  assert.equal(job.validateSync(), undefined);
  job.status = 'not_a_real_state';
  assert.ok(job.validateSync().errors.status);
});

test('socialPublisherService: enforces human approval gate', () => {
  const unapprovedDraft = new SocialDraft({
    projectId: new mongoose.Types.ObjectId(),
    campaignId: new mongoose.Types.ObjectId(),
    channel: 'linkedin',
    title: 'Unapproved test post',
    body: 'Copy goes here',
    status: 'draft',
    publishStatus: 'draft',
    scheduledFor: new Date()
  });

  assert.throws(
    () => assertHumanApproved(unapprovedDraft),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.match(err.message, /Human approval gate/);
      return true;
    }
  );

  const approvedDraft = new SocialDraft({
    projectId: new mongoose.Types.ObjectId(),
    campaignId: new mongoose.Types.ObjectId(),
    channel: 'linkedin',
    title: 'Approved test post',
    body: 'Copy goes here',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  assert.doesNotThrow(() => assertHumanApproved(approvedDraft));
});

test('socialAccountService: connects and encrypts webhook and API account credentials', async () => {
  if (mongoose.connection.readyState !== 1) return; // Skip DB integration test if offline

  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  // Connect webhook
  const webhookAcc = await connectSocialWebhook({
    projectId,
    userId,
    platform: 'webhook',
    accountName: 'Make Router',
    webhookUrl: 'https://hook.make.com/test-endpoint',
    webhookSecret: 'super-secret-key-123'
  });

  assert.equal(webhookAcc.accountName, 'Make Router');
  assert.notEqual(webhookAcc.webhookSecret, 'super-secret-key-123'); // Encrypted check

  // Decrypt credentials check
  const decryptedWebhook = await getDecryptedSocialAccountCredentials(webhookAcc._id);
  assert.equal(decryptedWebhook.webhookSecret, 'super-secret-key-123');
  assert.equal(decryptedWebhook.webhookUrl, 'https://hook.make.com/test-endpoint');

  // Connect API account
  const apiAcc = await connectSocialApiAccount({
    projectId,
    userId,
    platform: 'linkedin',
    accountName: 'Acme Corp LinkedIn',
    externalAccountId: 'urn:li:organization:9876',
    accessToken: 'linkedin-oauth-access-token-xyz'
  });

  assert.equal(apiAcc.platform, 'linkedin');
  assert.notEqual(apiAcc.accessToken, 'linkedin-oauth-access-token-xyz'); // Encrypted check

  const decryptedApi = await getDecryptedSocialAccountCredentials(apiAcc._id);
  assert.equal(decryptedApi.accessToken, 'linkedin-oauth-access-token-xyz');

  // List accounts
  const accounts = await listProjectSocialAccounts(projectId);
  assert.equal(accounts.length, 2);

  // Disconnect
  await disconnectSocialAccount({ projectId, accountId: apiAcc._id });
  const disconnected = await SocialAccount.findById(apiAcc._id).select('+accessToken');
  assert.equal(disconnected.status, 'disconnected');
  assert.equal(disconnected.accessToken, '');

  await SocialAccount.deleteMany({ projectId });
});

test('contentDistributionEngineService: creates a publish batch with one job per target account', async () => {
  if (mongoose.connection.readyState !== 1) return; // Skip DB integration test if offline

  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const campaignId = new mongoose.Types.ObjectId();

  const draft = await SocialDraft.create({
    projectId,
    campaignId,
    channel: 'linkedin',
    title: 'Approved launch post',
    body: 'Ready for the distribution engine.',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  const account = await connectSocialApiAccount({
    projectId,
    userId,
    platform: 'linkedin',
    accountName: 'Acme LinkedIn',
    externalAccountId: 'urn:li:organization:123',
    accessToken: 'sandbox_linkedin_access_token'
  });

  const { batch, jobs } = await createPublishBatch({
    projectId,
    userId,
    draftIds: [draft._id],
    accountIds: [account._id]
  });

  assert.equal(batch.summary.total, 1);
  assert.equal(batch.platforms[0], 'linkedin');
  assert.equal(jobs.length, 1);
  assert.equal(String(jobs[0].draftId), String(draft._id));
  assert.equal(String(jobs[0].accountId), String(account._id));
  assert.equal(jobs[0].status, 'queued');
  assert.equal(jobs[0].content.body, 'Ready for the distribution engine.');

  await PublishJob.deleteMany({ projectId });
  await PublishBatch.deleteMany({ projectId });
  await SocialDraft.deleteMany({ projectId });
  await SocialAccount.deleteMany({ projectId });
});

test('socialPublisherService: selects Instagram account before fallback targets', async () => {
  if (mongoose.connection.readyState !== 1) return; // Skip DB integration test if offline

  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const campaignId = new mongoose.Types.ObjectId();

  const draft = await SocialDraft.create({
    projectId,
    campaignId,
    channel: 'instagram',
    title: 'Instagram launch',
    body: 'A visual post.',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  await connectSocialApiAccount({
    projectId,
    userId,
    platform: 'facebook',
    accountName: 'Acme Facebook Page',
    externalAccountId: 'fb_page_123',
    accessToken: 'sandbox_meta_access_token'
  });

  const instagramAccount = await connectSocialApiAccount({
    projectId,
    userId,
    platform: 'instagram',
    accountName: 'Acme Instagram',
    externalAccountId: 'ig_business_123',
    accessToken: 'sandbox_meta_access_token'
  });

  const selected = await selectConnectedSocialAccount({ draft });
  assert.equal(String(selected._id), String(instagramAccount._id));
  assert.equal(selected.platform, 'instagram');

  await SocialDraft.deleteMany({ projectId });
  await SocialAccount.deleteMany({ projectId });
});

test('socialPublisherService: publishes approved social draft and records audit action', async () => {
  if (mongoose.connection.readyState !== 1) return; // Skip DB integration test if offline

  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const campaignId = new mongoose.Types.ObjectId();

  const project = new Project({
    _id: projectId,
    name: 'Acme Software',
    websiteUrl: 'https://acme.example.com',
    industry: 'SaaS'
  });

  const draft = await SocialDraft.create({
    projectId,
    campaignId,
    channel: 'x',
    title: 'New Feature Release',
    body: 'Check out our new feature release at https://acme.example.com/blog',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  await connectSocialApiAccount({
    projectId,
    userId,
    platform: 'x',
    accountName: '@AcmeSoftware',
    externalAccountId: 'x_user_123',
    accessToken: 'sandbox_twitter_access_token'
  });

  const result = await publishSocialDraft({
    socialDraftId: draft._id,
    userId,
    project
  });

  assert.equal(result.success, true);
  assert.ok(result.externalId);

  const updatedDraft = await SocialDraft.findById(draft._id);
  assert.equal(updatedDraft.publishStatus, 'published');
  assert.ok(updatedDraft.publishedAt);
  assert.ok(updatedDraft.platformPostId);

  // Check audit log PublishAction
  const action = await PublishAction.findOne({ socialDraftId: draft._id });
  assert.ok(action);
  assert.equal(action.status, 'success');
  assert.equal(action.integrationType, 'x');
  assert.equal(action.actionType, 'publish_social_post');

  await SocialDraft.deleteMany({ projectId });
  await SocialAccount.deleteMany({ projectId });
  await PublishAction.deleteMany({ projectId });
});

test('socialPublisherService: requires a connected account before live social publishing', async () => {
  if (mongoose.connection.readyState !== 1) return; // Skip DB integration test if offline

  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const campaignId = new mongoose.Types.ObjectId();

  const draft = await SocialDraft.create({
    projectId,
    campaignId,
    channel: 'linkedin',
    title: 'Approved but not connected',
    body: 'This should not silently become a manual publish.',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  await assert.rejects(
    () => publishSocialDraft({ socialDraftId: draft._id, userId }),
    /Connect a publishing account for linkedin before publishing/
  );

  const unchangedDraft = await SocialDraft.findById(draft._id);
  assert.equal(unchangedDraft.publishStatus, 'approved');

  await SocialDraft.deleteMany({ projectId });
  await PublishAction.deleteMany({ projectId });
});

test('socialPublisherService: batch publishes multiple approved drafts in one click', async () => {
  if (mongoose.connection.readyState !== 1) return; // Skip DB integration test if offline

  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const campaignId = new mongoose.Types.ObjectId();

  const draft1 = await SocialDraft.create({
    projectId,
    campaignId,
    channel: 'linkedin',
    title: 'Post 1',
    body: 'Copy 1',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  const draft2 = await SocialDraft.create({
    projectId,
    campaignId,
    channel: 'facebook',
    title: 'Post 2',
    body: 'Copy 2',
    status: 'approved',
    publishStatus: 'approved',
    scheduledFor: new Date()
  });

  await connectSocialApiAccount({
    projectId,
    userId,
    platform: 'linkedin',
    accountName: 'Acme LinkedIn',
    externalAccountId: 'urn:li:organization:123',
    accessToken: 'sandbox_linkedin_access_token'
  });

  await connectSocialApiAccount({
    projectId,
    userId,
    platform: 'facebook',
    accountName: 'Acme Facebook Page',
    externalAccountId: 'fb_page_123',
    accessToken: 'sandbox_meta_access_token'
  });

  const results = await batchPublishSocialDrafts({
    projectId,
    userId,
    draftIds: [draft1._id, draft2._id]
  });

  assert.equal(results.total, 2);
  assert.equal(results.successCount, 2);
  assert.equal(results.failedCount, 0);

  const published1 = await SocialDraft.findById(draft1._id);
  const published2 = await SocialDraft.findById(draft2._id);

  assert.equal(published1.publishStatus, 'published');
  assert.equal(published2.publishStatus, 'published');

  await SocialDraft.deleteMany({ projectId });
  await SocialAccount.deleteMany({ projectId });
  await PublishAction.deleteMany({ projectId });
});

const { publishFacebookPagePost, publishInstagramBusinessPost, inspectMetaToken } = require('../services/metaMcpService');

test('metaMcpService: publishes Facebook Page post and Instagram post in sandbox mode', async () => {
  const fbResult = await publishFacebookPagePost({
    accessToken: 'sandbox_meta_token',
    pageId: 'demo_page_id',
    message: 'Hello Facebook Page!'
  });
  assert.equal(fbResult.status, 'published');
  assert.ok(fbResult.externalId.startsWith('fb_post_sandbox_'));

  const igResult = await publishInstagramBusinessPost({
    accessToken: 'sandbox_meta_token',
    instagramAccountId: 'demo_ig_id',
    imageUrl: 'https://placehold.co/1080x1080.png',
    caption: 'Hello Instagram!'
  });
  assert.equal(igResult.status, 'published');
  assert.ok(igResult.externalId.startsWith('ig_post_sandbox_'));

  const tokenInfo = await inspectMetaToken({ accessToken: 'sandbox_meta_token' });
  assert.equal(tokenInfo.isValid, true);
  assert.ok(tokenInfo.scopes.includes('pages_manage_posts'));
});
