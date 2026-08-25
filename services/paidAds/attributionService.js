const crypto = require('crypto');
const env = require('../../config/env');
const PaidAttribution = require('../../models/PaidAttribution');

const CLICK_IDS = [
  ['gclid', 'google_ads'],
  ['gbraid', 'google_ads'],
  ['wbraid', 'google_ads'],
  ['fbclid', 'meta_ads'],
  ['liFatId', 'linkedin_ads'],
  ['ttclid', 'tiktok_ads']
];

function hashClickId(value) {
  if (!value) return '';
  return crypto.createHmac('sha256', env.tokenEncryptionSecret || env.jwtSecret)
    .update(String(value))
    .digest('hex');
}

function providerFromEvent(event) {
  const clickIds = event.clickIds || {};
  const clickMatch = CLICK_IDS.find(([name]) => clickIds[name]);
  if (clickMatch) return { provider: clickMatch[1], clickIdType: clickMatch[0], clickId: clickIds[clickMatch[0]] };

  const source = String(event.utmSource || '').toLowerCase();
  const medium = String(event.utmMedium || '').toLowerCase();
  const mapping = [
    [/google|adwords/, 'google_ads'],
    [/facebook|instagram|meta/, 'meta_ads'],
    [/linkedin/, 'linkedin_ads'],
    [/tiktok/, 'tiktok_ads']
  ];
  const sourceMatch = mapping.find(([pattern]) => pattern.test(source));
  if (sourceMatch && /paid|cpc|ppc|display|social|search/.test(medium)) {
    return { provider: sourceMatch[1], clickIdType: '', clickId: '' };
  }
  if (/paid|cpc|ppc/.test(medium)) return { provider: 'unknown_paid', clickIdType: '', clickId: '' };
  return null;
}

function confidenceForEvent(event, source) {
  if (source.clickId) return { score: 100, band: 'high', reason: `Exact ${source.clickIdType} click identifier captured.` };
  if (event.utmId && event.utmCampaign && event.utmContent) {
    return { score: 90, band: 'high', reason: 'Campaign, campaign ID, and creative UTM values captured.' };
  }
  if (event.utmCampaign) return { score: 75, band: 'medium', reason: 'Paid source and campaign UTM values captured.' };
  return { score: 50, band: 'medium', reason: 'Paid source detected without an exact click or campaign identifier.' };
}

async function recordPaidAttribution(event) {
  const source = providerFromEvent(event);
  if (!source || !event.funnelStage) return null;
  return PaidAttribution.findOneAndUpdate(
    { trackingEventId: event._id },
    {
      $set: {
        projectId: event.projectId,
        sessionId: event.sessionId,
        provider: source.provider,
        campaignExternalId: event.utmId || event.utmCampaign || '',
        adGroupExternalId: event.utmTerm || '',
        creativeExternalId: event.utmContent || '',
        clickIdType: source.clickIdType,
        clickIdHash: hashClickId(source.clickId),
        funnelStage: event.funnelStage,
        value: Number(event.eventValue || 0),
        currency: event.currency || '',
        confidence: confidenceForEvent(event, source),
        attributedAt: event.createdAt || new Date()
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

module.exports = {
  confidenceForEvent,
  hashClickId,
  providerFromEvent,
  recordPaidAttribution
};
