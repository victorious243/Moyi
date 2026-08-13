const SocialAccount = require('../models/SocialAccount');
const SocialOAuthSession = require('../models/SocialOAuthSession');
const PublishJob = require('../models/PublishJob');
const { decrypt, encrypt } = require('../utils/crypto');

const NATIVE_SOCIAL_PLATFORMS = ['bluesky', 'x', 'linkedin', 'facebook', 'instagram', 'threads', 'tiktok', 'youtube'];
const DIRECT_API_PLATFORMS = [...NATIVE_SOCIAL_PLATFORMS];
const CONNECTABLE_PLATFORMS = [...new Set([...NATIVE_SOCIAL_PLATFORMS, ...DIRECT_API_PLATFORMS, 'webhook'])];

function publicMetadata(metadata = {}) {
  return ['accountType', 'handle', 'username', 'memberUrn', 'organizationUrn', 'pageId', 'pageName', 'channelTitle']
    .reduce((safe, key) => {
      if (metadata[key]) safe[key] = metadata[key];
      return safe;
    }, {});
}

async function resumeAccountMetrics(accountId) {
  return PublishJob.updateMany(
    {
      accountId,
      status: 'published',
      metricsStatus: 'error',
      nextMetricsSyncAt: null
    },
    {
      $set: {
        metricsStatus: 'pending',
        metricsErrorCode: '',
        metricsErrorMessage: '',
        metricsAttempts: 0,
        nextMetricsSyncAt: new Date()
      }
    }
  );
}

async function listProjectSocialAccounts(projectId) {
  const accounts = await SocialAccount.find({ projectId })
    .select('+accessToken +refreshToken +webhookSecret')
    .sort({ platform: 1, createdAt: -1 });
  return accounts.map((acc) => ({
    id: acc._id,
    projectId: acc.projectId,
    userId: acc.userId,
    platform: acc.platform,
    accountName: acc.accountName,
    externalAccountId: acc.externalAccountId,
    webhookUrl: acc.webhookUrl,
    hasAccessToken: Boolean(acc.accessToken),
    hasRefreshToken: Boolean(acc.refreshToken),
    hasWebhookSecret: Boolean(acc.webhookSecret),
    tokenExpiresAt: acc.tokenExpiresAt,
    scopes: [...(acc.scopes || [])],
    metadata: publicMetadata(acc.metadata),
    status: acc.status,
    statusMessage: acc.statusMessage,
    lastSyncAt: acc.lastSyncAt,
    reconnectRequiredAt: acc.reconnectRequiredAt,
    metricsStatus: acc.metricsStatus,
    metricsStatusMessage: acc.metricsStatusMessage,
    lastMetricsSyncAt: acc.lastMetricsSyncAt,
    createdAt: acc.createdAt
  }));
}

async function connectSocialWebhook({ projectId, userId, platform, accountName, webhookUrl, webhookSecret }) {
  if (!webhookUrl || !webhookUrl.startsWith('http')) {
    const error = new Error('A valid HTTP or HTTPS webhook URL is required.');
    error.statusCode = 400;
    throw error;
  }

  const existing = await SocialAccount.findOne({
    projectId,
    platform: platform || 'webhook',
    webhookUrl
  }).select('+webhookSecret');

  const payload = {
    projectId,
    userId,
    platform: platform || 'webhook',
    accountName: accountName || 'Custom Outgoing Webhook',
    webhookUrl,
    webhookSecret: webhookSecret ? encrypt(webhookSecret) : '',
    status: 'connected',
    statusMessage: 'Webhook connected successfully.',
    lastSyncAt: new Date()
  };

  if (existing) {
    Object.assign(existing, payload);
    const saved = await existing.save();
    await resumeAccountMetrics(saved._id);
    return saved;
  }

  return SocialAccount.create(payload);
}

async function connectSocialApiAccount({
  projectId,
  userId,
  platform,
  accountName,
  externalAccountId = '',
  accessToken = '',
  refreshToken = '',
  expiresInSeconds = null,
  expiresAt = null,
  scopes = [],
  metadata = {}
}) {
  if (!platform || !accountName) {
    const error = new Error('Platform and account name are required.');
    error.statusCode = 400;
    throw error;
  }
  if (!accessToken && platform !== 'bluesky') {
    const error = new Error('Access token is required for direct social API connections.');
    error.statusCode = 400;
    throw error;
  }

  const tokenExpiresAt = expiresAt
    ? new Date(expiresAt)
    : expiresInSeconds
      ? new Date(Date.now() + expiresInSeconds * 1000)
      : null;

  const existing = await SocialAccount.findOne({
    projectId,
    platform,
    ...(externalAccountId ? { externalAccountId } : { accountName })
  }).select('+accessToken +refreshToken');

  const payload = {
    projectId,
    userId,
    platform,
    accountName,
    externalAccountId,
    accessToken: platform === 'bluesky' ? '' : (accessToken ? encrypt(accessToken) : (existing ? existing.accessToken : '')),
    refreshToken: platform === 'bluesky' ? '' : (refreshToken ? encrypt(refreshToken) : (existing ? existing.refreshToken : '')),
    tokenExpiresAt: tokenExpiresAt || (existing ? existing.tokenExpiresAt : null),
    scopes: Array.isArray(scopes) ? scopes : [],
    metadata: {
      ...(existing && existing.metadata ? existing.metadata : {}),
      ...(metadata || {})
    },
    status: 'connected',
    statusMessage: `Connected to ${platform} successfully.`,
    reconnectRequiredAt: null,
    metricsStatus: 'pending',
    metricsStatusMessage: '',
    lastSyncAt: new Date()
  };

  if (existing) {
    Object.assign(existing, payload);
    return existing.save();
  }

  return SocialAccount.create(payload);
}

async function disconnectSocialAccount({ projectId, accountId }) {
  const account = await SocialAccount.findOne({ _id: accountId, projectId })
    .select('+accessToken +refreshToken +webhookSecret');
  if (!account) {
    const error = new Error('Social account connection not found.');
    error.statusCode = 404;
    throw error;
  }

  account.status = 'disconnected';
  account.statusMessage = 'Disconnected by user.';
  account.accessToken = '';
  account.refreshToken = '';
  account.webhookSecret = '';
  if (account.platform === 'bluesky' && account.metadata && account.metadata.oauthSessionKey) {
    await SocialOAuthSession.deleteOne({
      platform: 'bluesky',
      kind: 'session',
      key: String(account.metadata.oauthSessionKey)
    });
  }
  return account.save();
}

async function getDecryptedSocialAccountCredentials(accountId, ownership = {}) {
  const query = { _id: accountId };
  if (ownership.projectId) query.projectId = ownership.projectId;
  if (ownership.userId) query.userId = ownership.userId;
  const account = await SocialAccount.findOne(query).select('+accessToken +refreshToken +webhookSecret');
  if (!account) return null;

  return {
    id: String(account._id),
    projectId: String(account.projectId),
    userId: String(account.userId),
    platform: account.platform,
    accountName: account.accountName,
    externalAccountId: account.externalAccountId,
    webhookUrl: account.webhookUrl,
    accessToken: account.accessToken ? decrypt(account.accessToken) : '',
    refreshToken: account.refreshToken ? decrypt(account.refreshToken) : '',
    expiresAt: account.tokenExpiresAt,
    scopes: [...(account.scopes || [])],
    metadata: account.metadata || {},
    webhookSecret: account.webhookSecret ? decrypt(account.webhookSecret) : '',
    status: account.status
  };
}

async function updateSocialAccountTokens(accountId, tokens, options = {}) {
  const account = await SocialAccount.findById(accountId);
  if (!account) {
    const error = new Error('Social account connection not found.');
    error.statusCode = 404;
    throw error;
  }

  const expiresAt = tokens.expiresAt
    ? new Date(tokens.expiresAt)
    : tokens.expiresInSeconds
      ? new Date(Date.now() + Number(tokens.expiresInSeconds) * 1000)
      : account.tokenExpiresAt;
  const mergedMetadata = tokens.metadata ? { ...(account.metadata || {}), ...tokens.metadata } : null;
  const update = {
    ...(tokens.accessToken ? { accessToken: encrypt(tokens.accessToken) } : {}),
    ...(tokens.refreshToken ? { refreshToken: encrypt(tokens.refreshToken) } : {}),
    ...(expiresAt ? { tokenExpiresAt: expiresAt } : {}),
    ...(Array.isArray(tokens.scopes) ? { scopes: tokens.scopes } : {}),
    ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
    status: 'connected',
    statusMessage: `Connected to ${account.platform} successfully.`,
    reconnectRequiredAt: null,
    lastSyncAt: new Date()
  };

  const siblingQuery = options.propagateConnection && account.metadata && account.metadata.memberUrn
    ? {
        projectId: account.projectId,
        userId: account.userId,
        platform: account.platform,
        'metadata.memberUrn': account.metadata.memberUrn,
        status: { $ne: 'disconnected' }
      }
    : { _id: account._id };

  if (options.propagateConnection && mergedMetadata) delete update.metadata;
  await SocialAccount.updateMany(siblingQuery, { $set: update });
  if (options.propagateConnection && mergedMetadata) {
    await SocialAccount.updateOne({ _id: account._id }, { $set: { metadata: mergedMetadata } });
  }
  const resumedAccounts = await SocialAccount.find(siblingQuery).select('_id').lean();
  await Promise.all(resumedAccounts.map((item) => resumeAccountMetrics(item._id)));
  return SocialAccount.findById(account._id);
}

async function markSocialAccountError(accountId, message, options = {}) {
  const safeMessage = String(message || 'The social account must be reconnected.').slice(0, 500);
  const account = await SocialAccount.findById(accountId);
  if (!account) return null;
  const query = options.propagateConnection && account.metadata && account.metadata.memberUrn
    ? {
        projectId: account.projectId,
        userId: account.userId,
        platform: account.platform,
        'metadata.memberUrn': account.metadata.memberUrn,
        status: { $ne: 'disconnected' }
      }
    : { _id: account._id };
  await SocialAccount.updateMany(query, {
    $set: {
      status: 'error',
      statusMessage: safeMessage,
      lastSyncAt: new Date()
    }
  });
  return SocialAccount.findById(account._id);
}

async function markSocialAccountReconnectRequired(accountId, message, options = {}) {
  const safeMessage = String(message || 'Reconnect this social account to continue publishing.').slice(0, 500);
  const account = await SocialAccount.findById(accountId);
  if (!account) return null;
  const query = options.propagateConnection && account.metadata && account.metadata.memberUrn
    ? {
        projectId: account.projectId,
        userId: account.userId,
        platform: account.platform,
        'metadata.memberUrn': account.metadata.memberUrn,
        status: { $ne: 'disconnected' }
      }
    : { _id: account._id };
  await SocialAccount.updateMany(query, {
    $set: {
      status: 'reconnect_required',
      statusMessage: safeMessage,
      reconnectRequiredAt: new Date(),
      metricsStatus: 'error',
      metricsStatusMessage: 'Reconnect this account to resume engagement collection.',
      lastSyncAt: new Date()
    }
  });
  return SocialAccount.findById(account._id);
}

module.exports = {
  CONNECTABLE_PLATFORMS,
  DIRECT_API_PLATFORMS,
  NATIVE_SOCIAL_PLATFORMS,
  listProjectSocialAccounts,
  connectSocialWebhook,
  connectSocialApiAccount,
  disconnectSocialAccount,
  getDecryptedSocialAccountCredentials,
  markSocialAccountError,
  markSocialAccountReconnectRequired,
  resumeAccountMetrics,
  updateSocialAccountTokens
};
