const path = require('path');
const { pathToFileURL } = require('url');

let distributionModulePromise;

function loadDistributionModule() {
  if (!distributionModulePromise) {
    const builtEntry = path.join(__dirname, '../dist/distribution/index.mjs');
    distributionModulePromise = import(pathToFileURL(builtEntry).href);
  }
  return distributionModulePromise;
}

async function getAuthorizationRequest(platform, input) {
  return (await loadDistributionModule()).getAuthorizationRequest(platform, input);
}

async function connectProvider(platform, code, context) {
  return (await loadDistributionModule()).connectProvider(platform, code, context);
}

async function refreshProviderToken(platform, account) {
  return (await loadDistributionModule()).refreshProviderToken(platform, account);
}

async function publishWithProvider(platform, account, payload) {
  return (await loadDistributionModule()).publishWithProvider(platform, account, payload);
}

async function getProviderPublishStatus(platform, account, state) {
  return (await loadDistributionModule()).getProviderPublishStatus(platform, account, state);
}

async function getProviderMetrics(platform, account, post) {
  return (await loadDistributionModule()).getProviderMetrics(platform, account, post);
}

async function getTikTokCreatorInfo(account) {
  return (await loadDistributionModule()).getTikTokCreatorInfo(account);
}

async function getBlueskyClientMetadata() {
  return (await loadDistributionModule()).getBlueskyClientMetadata();
}

async function getBlueskyJwks() {
  return (await loadDistributionModule()).getBlueskyJwks();
}

async function nativeSocialPlatforms() {
  return (await loadDistributionModule()).nativeSocialPlatforms();
}

module.exports = {
  connectProvider,
  getAuthorizationRequest,
  getBlueskyClientMetadata,
  getBlueskyJwks,
  getProviderPublishStatus,
  getProviderMetrics,
  getTikTokCreatorInfo,
  loadDistributionModule,
  nativeSocialPlatforms,
  publishWithProvider,
  refreshProviderToken
};
