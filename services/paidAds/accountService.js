const PaidAdAccount = require('../../models/PaidAdAccount');
const { decrypt, encrypt } = require('../../utils/crypto');
const { getPaidAdsProvider } = require('./providerRegistry');

function expiresAtSoon(value, windowMs = 5 * 60 * 1000) {
  return value && new Date(value).getTime() <= Date.now() + windowMs;
}

async function connectPaidAdAccounts({ projectId, userId, providerName, code }) {
  const provider = getPaidAdsProvider(providerName);
  const tokens = await provider.exchangeCode(code);
  const accounts = await provider.listAccounts(tokens);
  if (!accounts.length) {
    const error = new Error(`No accessible advertising accounts were returned by ${providerName}.`);
    error.statusCode = 422;
    throw error;
  }

  const saved = [];
  for (const account of accounts) {
    const existing = await PaidAdAccount.findOne({
      projectId,
      provider: providerName,
      externalAccountId: account.externalAccountId
    }).select('+encryptedAccessToken +encryptedRefreshToken');
    const refreshToken = tokens.refreshToken || (existing && decrypt(existing.encryptedRefreshToken)) || '';
    const update = {
      projectId,
      connectedByUserId: userId,
      provider: providerName,
      externalAccountId: account.externalAccountId,
      accountName: account.accountName,
      currency: account.currency,
      timezone: account.timezone,
      encryptedAccessToken: encrypt(tokens.accessToken),
      encryptedRefreshToken: encrypt(refreshToken),
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      status: 'active',
      syncStatus: 'idle',
      lastSyncError: '',
      metadata: account.metadata || {}
    };
    saved.push(await PaidAdAccount.findOneAndUpdate(
      { projectId, provider: providerName, externalAccountId: account.externalAccountId },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ));
  }
  return saved;
}

async function accountWithSecrets(accountId) {
  const account = await PaidAdAccount.findById(accountId).select('+encryptedAccessToken +encryptedRefreshToken');
  if (!account) {
    const error = new Error('Paid advertising account not found.');
    error.statusCode = 404;
    throw error;
  }
  return account;
}

async function usableAccessToken(account) {
  const provider = getPaidAdsProvider(account.provider);
  const currentAccessToken = decrypt(account.encryptedAccessToken);
  if (!expiresAtSoon(account.expiresAt)) return currentAccessToken;

  const refreshCredential = decrypt(account.encryptedRefreshToken) || currentAccessToken;
  if (!refreshCredential) {
    account.status = 'reconnect_required';
    account.lastSyncError = 'The provider token expired and no refresh credential is available.';
    await account.save();
    const error = new Error(account.lastSyncError);
    error.code = 'reconnect_required';
    throw error;
  }

  try {
    const tokens = await provider.refreshToken(refreshCredential);
    account.encryptedAccessToken = encrypt(tokens.accessToken);
    if (tokens.refreshToken) account.encryptedRefreshToken = encrypt(tokens.refreshToken);
    account.expiresAt = tokens.expiresAt;
    account.scopes = tokens.scopes.length ? tokens.scopes : account.scopes;
    account.status = 'active';
    account.lastSyncError = '';
    await account.save();
    return tokens.accessToken;
  } catch (error) {
    account.status = 'reconnect_required';
    account.lastSyncError = 'Token refresh failed. Reconnect this advertising account.';
    await account.save();
    throw error;
  }
}

module.exports = {
  accountWithSecrets,
  connectPaidAdAccounts,
  expiresAtSoon,
  usableAccessToken
};

