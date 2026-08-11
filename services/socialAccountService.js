const SocialAccount = require('../models/SocialAccount');
const { decrypt, encrypt } = require('../utils/crypto');

async function listProjectSocialAccounts(projectId) {
  const accounts = await SocialAccount.find({ projectId }).sort({ platform: 1, createdAt: -1 });
  return accounts.map((acc) => ({
    id: acc._id,
    projectId: acc.projectId,
    userId: acc.userId,
    platform: acc.platform,
    accountName: acc.accountName,
    externalAccountId: acc.externalAccountId,
    webhookUrl: acc.webhookUrl,
    hasAccessToken: Boolean(acc.accessToken),
    hasWebhookSecret: Boolean(acc.webhookSecret),
    status: acc.status,
    statusMessage: acc.statusMessage,
    lastSyncAt: acc.lastSyncAt,
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
    accountName: accountName || 'Custom Webhook'
  });

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
    return existing.save();
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
  expiresInSeconds = null
}) {
  if (!platform || !accountName) {
    const error = new Error('Platform and account name are required.');
    error.statusCode = 400;
    throw error;
  }

  const tokenExpiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null;

  const existing = await SocialAccount.findOne({
    projectId,
    platform,
    accountName
  });

  const payload = {
    projectId,
    userId,
    platform,
    accountName,
    externalAccountId,
    accessToken: accessToken ? encrypt(accessToken) : (existing ? existing.accessToken : ''),
    refreshToken: refreshToken ? encrypt(refreshToken) : (existing ? existing.refreshToken : ''),
    tokenExpiresAt,
    status: 'connected',
    statusMessage: `Connected to ${platform} successfully.`,
    lastSyncAt: new Date()
  };

  if (existing) {
    Object.assign(existing, payload);
    return existing.save();
  }

  return SocialAccount.create(payload);
}

async function disconnectSocialAccount({ projectId, accountId }) {
  const account = await SocialAccount.findOne({ _id: accountId, projectId });
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
  return account.save();
}

async function getDecryptedSocialAccountCredentials(accountId) {
  const account = await SocialAccount.findById(accountId);
  if (!account) return null;

  return {
    id: account._id,
    projectId: account.projectId,
    userId: account.userId,
    platform: account.platform,
    accountName: account.accountName,
    externalAccountId: account.externalAccountId,
    webhookUrl: account.webhookUrl,
    accessToken: account.accessToken ? decrypt(account.accessToken) : '',
    refreshToken: account.refreshToken ? decrypt(account.refreshToken) : '',
    webhookSecret: account.webhookSecret ? decrypt(account.webhookSecret) : '',
    status: account.status
  };
}

module.exports = {
  listProjectSocialAccounts,
  connectSocialWebhook,
  connectSocialApiAccount,
  disconnectSocialAccount,
  getDecryptedSocialAccountCredentials
};
