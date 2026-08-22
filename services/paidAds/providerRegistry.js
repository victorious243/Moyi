const GoogleAdsProvider = require('./providers/googleAds');
const MetaAdsProvider = require('./providers/metaAds');
const ApprovalGatedProvider = require('./providers/approvalGated');

const providers = new Map([
  ['google_ads', new GoogleAdsProvider()],
  ['meta_ads', new MetaAdsProvider()],
  ['linkedin_ads', new ApprovalGatedProvider(
    'linkedin_ads',
    'LinkedIn Ads reporting is awaiting Marketing API approval. Required scopes: r_ads and r_ads_reporting.',
    ['r_ads', 'r_ads_reporting']
  )],
  ['tiktok_ads', new ApprovalGatedProvider(
    'tiktok_ads',
    'TikTok Ads reporting is awaiting TikTok API for Business approval for account and consolidated reporting access.',
    ['Reporting > Consolidated Report', 'Ads Management read access']
  )]
]);

function getPaidAdsProvider(name) {
  const provider = providers.get(String(name || '').toLowerCase());
  if (!provider) {
    const error = new Error(`Unsupported paid advertising provider: ${name}`);
    error.statusCode = 400;
    throw error;
  }
  return provider;
}

function providerCatalog() {
  return [
    { id: 'google_ads', name: 'Google Ads', live: true },
    { id: 'meta_ads', name: 'Meta Ads', live: true },
    { id: 'linkedin_ads', name: 'LinkedIn Ads', live: false },
    { id: 'tiktok_ads', name: 'TikTok Ads', live: false }
  ];
}

module.exports = { getPaidAdsProvider, providerCatalog };
