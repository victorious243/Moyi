const SocialAccount = require('../models/SocialAccount');
const {
  NATIVE_SOCIAL_PLATFORMS,
  getDecryptedSocialAccountCredentials,
  markSocialAccountError,
  markSocialAccountReconnectRequired,
  updateSocialAccountTokens
} = require('./socialAccountService');
const { refreshProviderToken } = require('./socialProviderService');

const PUBLISH_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const BACKGROUND_REFRESH_WINDOW_MS = 48 * 60 * 60 * 1000;

function connectionKey(account) {
  if (account.platform === 'linkedin' && account.metadata && account.metadata.memberUrn) {
    return `${account.projectId}:linkedin:${account.metadata.memberUrn}`;
  }
  return String(account._id);
}

function requiresReconnect(error) {
  return ['reauthorization_required', 'provider_not_configured'].includes(error && error.code) ||
    [400, 401, 403].includes(Number(error && error.statusCode));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function refreshLockAccount(account) {
  if (account.platform !== 'linkedin' || !account.metadata || !account.metadata.memberUrn) return account;
  return SocialAccount.findOne({
    projectId: account.projectId,
    userId: account.userId,
    platform: 'linkedin',
    'metadata.memberUrn': account.metadata.memberUrn,
    status: 'connected'
  }).sort({ 'metadata.accountType': 1, createdAt: 1 }) || account;
}

async function waitForConcurrentRefresh(lockAccount, requestedAccount) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(250);
    const current = await SocialAccount.findById(lockAccount._id).select('+tokenRefreshLockedUntil');
    if (!current || current.status !== 'connected') {
      throw new Error('The social account must be reconnected.');
    }
    const lockActive = current.tokenRefreshLockedUntil && current.tokenRefreshLockedUntil.getTime() > Date.now();
    const expiryMoved = current.tokenExpiresAt && (!lockAccount.tokenExpiresAt || current.tokenExpiresAt.getTime() > lockAccount.tokenExpiresAt.getTime());
    if (expiryMoved) {
      return getDecryptedSocialAccountCredentials(requestedAccount._id, {
        projectId: requestedAccount.projectId,
        userId: requestedAccount.userId
      });
    }
    if (!lockActive) {
      const error = new Error('The concurrent social token refresh did not complete.');
      error.code = 'token_refresh_incomplete';
      throw error;
    }
  }
  const error = new Error('Timed out waiting for the social account token refresh.');
  error.code = 'token_refresh_lock_timeout';
  throw error;
}

async function refreshSocialAccount(accountOrId) {
  const account = typeof accountOrId === 'object'
    ? accountOrId
    : await SocialAccount.findById(accountOrId);
  if (!account || !['connected', 'reconnect_required'].includes(account.status)) {
    const error = new Error('The selected social account is not connected.');
    error.statusCode = 422;
    throw error;
  }

  const lockTarget = await refreshLockAccount(account);
  const lockUntil = new Date(Date.now() + 30 * 1000);
  const claimed = await SocialAccount.findOneAndUpdate(
    {
      _id: lockTarget._id,
      status: { $in: ['connected', 'reconnect_required'] },
      $or: [
        { tokenRefreshLockedUntil: null },
        { tokenRefreshLockedUntil: { $exists: false } },
        { tokenRefreshLockedUntil: { $lte: new Date() } }
      ]
    },
    { $set: { tokenRefreshLockedUntil: lockUntil } },
    { new: true, select: '+tokenRefreshLockedUntil' }
  );
  if (!claimed) return waitForConcurrentRefresh(lockTarget, account);

  try {
    const credentials = await getDecryptedSocialAccountCredentials(claimed._id, {
      projectId: claimed.projectId,
      userId: claimed.userId
    });
    const tokens = await refreshProviderToken(claimed.platform, credentials);
    await updateSocialAccountTokens(claimed._id, tokens, {
      propagateConnection: claimed.platform === 'linkedin'
    });
    return getDecryptedSocialAccountCredentials(account._id, {
      projectId: account.projectId,
      userId: account.userId
    });
  } finally {
    await SocialAccount.updateOne(
      { _id: claimed._id, tokenRefreshLockedUntil: lockUntil },
      { $set: { tokenRefreshLockedUntil: null } }
    ).catch(() => null);
  }
}

async function ensureFreshSocialAccountCredentials(account) {
  const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : null;
  if (!expiresAt || expiresAt > Date.now() + PUBLISH_REFRESH_WINDOW_MS) {
    return getDecryptedSocialAccountCredentials(account._id, {
      projectId: account.projectId,
      userId: account.userId
    });
  }

  try {
    return await refreshSocialAccount(account);
  } catch (error) {
    if (requiresReconnect(error)) {
      await markSocialAccountReconnectRequired(account._id, error.message, { propagateConnection: account.platform === 'linkedin' });
    }
    throw error;
  }
}

async function refreshExpiringSocialAccounts({ withinMs = BACKGROUND_REFRESH_WINDOW_MS } = {}) {
  const accounts = await SocialAccount.find({
    platform: { $in: NATIVE_SOCIAL_PLATFORMS },
    status: { $in: ['connected', 'reconnect_required'] },
    refreshToken: { $exists: true, $ne: '' },
    $or: [
      { tokenExpiresAt: { $ne: null, $lte: new Date(Date.now() + withinMs) } },
      { status: 'reconnect_required' }
    ]
  }).sort({ tokenExpiresAt: 1 });

  const uniqueConnections = new Map();
  accounts.forEach((account) => {
    const key = connectionKey(account);
    const existing = uniqueConnections.get(key);
    const isPerson = account.metadata && account.metadata.accountType === 'person';
    if (!existing || isPerson) uniqueConnections.set(key, account);
  });

  const summary = { checked: uniqueConnections.size, refreshed: 0, failed: 0, errors: [] };
  for (const account of uniqueConnections.values()) {
    try {
      await refreshSocialAccount(account);
      summary.refreshed += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({ accountId: String(account._id), platform: account.platform, error: error.message });
      if (requiresReconnect(error)) {
        await markSocialAccountReconnectRequired(account._id, error.message, { propagateConnection: account.platform === 'linkedin' });
      }
    }
  }
  return summary;
}

module.exports = {
  BACKGROUND_REFRESH_WINDOW_MS,
  PUBLISH_REFRESH_WINDOW_MS,
  ensureFreshSocialAccountCredentials,
  refreshExpiringSocialAccounts,
  refreshSocialAccount
};
